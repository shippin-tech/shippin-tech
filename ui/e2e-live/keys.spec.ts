import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

// One key, one job, in a real browser against the local stack (KEYS.md). Each service's
// keys are shown without their bytes, and replacing one, at random or with a pasted key,
// seals that service's secrets again under the new key: the saved AI key still reaches the
// AI service afterwards, and the old key is destroyed.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const providerKey = `stand-in-provider-key-${run}`;
const pasted = randomBytes(32).toString('base64');
const PORT = 28029;

const seen: string[] = [];
const service = createServer((req, res) => {
	req.resume();
	req.on('end', () => {
		seen.push(String(req.headers.authorization ?? ''));
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }));
	});
});

type KeyView = { id: number; origin: string; kept: string; state: string; readable: boolean };
type Report = { services: { service: string; keys: KeyView[] }[]; wrapping: { path: string; madeHere: boolean; readable: boolean } };

async function keysText(auth = adminAuth) {
	return fetch(`${base}/api/keys`, { headers: { Authorization: auth } });
}

async function aiTest() {
	const before = seen.length;
	const res = await fetch(`${base}/api/ai/test`, { method: 'POST', headers: { Authorization: adminAuth } });
	expect(res.status).toBe(200);
	expect(seen.length).toBe(before + 1);
	return seen.at(-1);
}

test.beforeAll(async () => {
	await new Promise<void>((done) => service.listen(PORT, '0.0.0.0', done));
});

test.afterEach(async ({ browser }) => {
	await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
	service.close();
	await fetch(`${base}/api/ai/settings`, { method: 'DELETE', headers: { Authorization: adminAuth } });
});

test('each service has its own key, shown without its bytes, and replacing one keeps its secrets', async ({ page }) => {
	test.setTimeout(180_000);
	expect((await fetch(`${base}/api/keys`)).status).toBe(401);

	// A secret for the AI service to keep.
	const saved = await fetch(`${base}/api/ai/settings`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'openai', endpoint: `http://host.docker.internal:${PORT}/v1`, model: 'm', key: providerKey, assistant: false })
	});
	expect(saved.status).toBe(200);
	expect(await aiTest()).toBe(`Bearer ${providerKey}`);

	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Keys' }).click();
	await expect(page.getByRole('heading', { name: 'Keys', level: 1 })).toBeVisible({ timeout: 30_000 });

	// Every service gets its key.
	const author = page.getByRole('button', { name: 'Make the missing keys' });
	if (await author.isVisible()) await author.click();
	for (const name of ['AI provider key', 'Sign-in secrets', 'Google link', 'Domain proof']) {
		await expect(page.getByRole('region', { name }).getByText(/^Key \d+: .* In use\.$/)).toBeVisible({ timeout: 30_000 });
	}
	await expect(page.getByRole('region', { name: 'Key-wrapping key' })).toContainText('The server can read it.');
	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// Replaced at random: the secret is sealed again, the old key destroyed, the secret still works.
	const ai = page.getByRole('form', { name: 'New key for AI provider key' });
	await ai.getByRole('button', { name: /Replace the key/ }).click();
	await expect(page.getByText(/^AI provider key: key \d+ is in use\. 1 value was sealed again\. The old key was destroyed\.$/)).toBeVisible({
		timeout: 30_000
	});
	expect(await aiTest()).toBe(`Bearer ${providerKey}`);

	// Replaced with a key of my own, pasted.
	await ai.getByLabel('Paste my own').check();
	await ai.getByLabel(/Your key/).fill('not a key');
	await ai.getByRole('button', { name: /Replace the key/ }).click();
	await expect(ai.getByRole('alert')).toContainText('44 characters');
	await ai.getByLabel(/Your key/).fill(pasted);
	await ai.getByRole('button', { name: /Replace the key/ }).click();
	await expect(page.getByText(/^AI provider key: key \d+ is in use\. 1 value was sealed again\. The old key was destroyed\.$/)).toBeVisible({
		timeout: 30_000
	});
	expect(await aiTest()).toBe(`Bearer ${providerKey}`);
	await expect(page.getByRole('complementary', { name: 'Author your keys' }).getByText('All done.')).toBeVisible({ timeout: 30_000 });

	// What the server says about keys never holds a key.
	const text = await (await keysText()).text();
	expect(text).not.toContain(pasted);
	expect(text).not.toContain(providerKey);
	const report = JSON.parse(text) as Report;
	const aiKeys = report.services.find((item) => item.service === 'ai')!.keys;
	expect(aiKeys).toHaveLength(1);
	expect(aiKeys[0]).toMatchObject({ origin: 'yours', kept: 'stored', state: 'primary', readable: true });
	expect(report.wrapping).toMatchObject({ madeHere: true, readable: true });

	// A key from a variable that is not there is refused, and nothing changes.
	const missing = await fetch(`${base}/api/keys/ai/replace`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ from: 'environmentVariable', name: `SHIPPIN_NOT_SET_${run.toUpperCase()}` })
	});
	expect(missing.status).toBe(400);
	expect(((await missing.json()) as { message?: string; detail?: string }).message ?? '').toMatch(/is not set/);
	expect(await aiTest()).toBe(`Bearer ${providerKey}`);
	expect((JSON.parse(await (await keysText()).text()) as Report).services.find((item) => item.service === 'ai')!.keys).toHaveLength(1);

	// Keys are for the server's administrators only.
	const signup = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain: `keys-${run}.test`, name: 'owner', password: `Keys check ${run} pw` })
	});
	expect(signup.status).toBe(200);
	const owner = 'Basic ' + Buffer.from(`owner@keys-${run}.test:Keys check ${run} pw`).toString('base64');
	expect((await keysText(owner)).status).toBe(403);
	expect((await fetch(`${base}/api/keys/ai/replace`, { method: 'POST', headers: { Authorization: owner } })).status).toBe(403);
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: owner, 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: `keys-${run}.test` })
	});
});
