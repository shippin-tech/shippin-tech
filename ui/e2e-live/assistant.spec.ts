import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

// The assistant in a real browser against the local stack, with stand-ins for both kinds
// of AI service on the host. It is off until set, keeps the key to itself, and tells
// each person only what their role should see.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const domain = `assist-${run}.test`;
const password = `Assistant check ${run} pw`;
const owner = `owner@${domain}`;
const key = `stand-in-key-${run}`;
const standIn = 'http://host.docker.internal:28028';

type Seen = { path: string; auth: string; xKey: string; version: string; body: { model: string; system?: string; messages: { role: string; content: string }[]; max_tokens?: number } };
const seen: Seen[] = [];
let mode: 'ok' | 'refuse' | 'down' = 'ok';

const service = createServer((req, res) => {
	let body = '';
	req.on('data', (chunk) => (body += chunk));
	req.on('end', () => {
		seen.push({
			path: req.url ?? '',
			auth: String(req.headers.authorization ?? ''),
			xKey: String(req.headers['x-api-key'] ?? ''),
			version: String(req.headers['anthropic-version'] ?? ''),
			body: JSON.parse(body)
		});
		res.setHeader('Content-Type', 'application/json');
		if (mode === 'down') {
			res.statusCode = 500;
			res.end('{"error":"down"}');
		} else if (req.url === '/v1/chat/completions') {
			res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Open /mail to read your mail.' } }] }));
		} else if (mode === 'refuse') {
			res.end(JSON.stringify({ stop_reason: 'refusal', content: [] }));
		} else {
			res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Open /calendar for that.' }] }));
		}
	});
});

test.beforeAll(async () => {
	await new Promise<void>((done) => service.listen(28028, '0.0.0.0', done));
});

test.afterEach(async ({ browser }) => {
	await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
	service.close();
	await fetch(`${base}/api/ai/settings`, { method: 'DELETE', headers: { Authorization: adminAuth } });
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: basic(), 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: domain })
	});
});

function basic() {
	return 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64');
}

async function settings(body: unknown) {
	return fetch(`${base}/api/ai/settings`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

test('the assistant is off until set, answers from the guide, and keeps its key', async ({ page, browser }) => {
	test.setTimeout(180_000);
	await fetch(`${base}/api/ai/settings`, { method: 'DELETE', headers: { Authorization: adminAuth } });
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);

	expect((await fetch(`${base}/api/assistant`)).status).toBe(401);
	expect((await fetch(`${base}/api/ai/settings`, { headers: { Authorization: basic() } })).status).toBe(403);
	expect((await (await fetch(`${base}/api/assistant`, { headers: { Authorization: basic() } })).json()) as unknown).toEqual({ enabled: false });
	const off = await fetch(`${base}/api/assistant`, {
		method: 'POST',
		headers: { Authorization: basic(), 'Content-Type': 'application/json' },
		body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] })
	});
	expect(off.status).toBe(409);

	// The administrator sets it up in the browser.
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'Ask for help' })).toHaveCount(0);
	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'AI settings' }).click();
	await expect(page.getByRole('heading', { name: 'AI settings', level: 1 })).toBeVisible({ timeout: 30_000 });
	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	const form = page.getByRole('form', { name: 'AI settings' });
	await form.getByLabel('Address').fill('nonsense');
	await form.getByRole('button', { name: 'Save settings' }).click();
	await expect(form.getByRole('alert')).toContainText('starts with');
	await form.getByLabel('Address').fill(`${standIn}/v1`);
	await form.getByLabel('Model name').fill('local-model');
	await form.getByLabel(/^Key/).fill(key);
	const notice = form.getByRole('complementary', { name: 'About this key' });
	await expect(notice).toContainText('Paste your AI key here. This is the right place for it.');
	await expect(notice).toContainText('Redirects are refused');
	await form.getByLabel('Offer the assistant').check();
	await form.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Saved.')).toBeVisible({ timeout: 30_000 });

	await form.getByRole('button', { name: 'Test the connection' }).click();
	await expect(page.getByText('It works. The model answered: Open /mail to read your mail.')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('complementary', { name: 'Turn on the assistant' }).getByText('All done.')).toBeVisible({ timeout: 30_000 });
	expect(seen.at(-1)).toMatchObject({ path: '/v1/chat/completions', auth: `Bearer ${key}` });
	expect(seen.at(-1)?.body.model).toBe('local-model');

	// Every key on the server, explained in one place.
	const keys = await (await browser.newContext()).newPage();
	await keys.goto('/keys');
	await expect(keys.getByRole('heading', { name: 'Your keys on this server', level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(keys.getByRole('heading', { level: 2 })).toHaveCount(6);
	const keysSerious = (await new AxeBuilder({ page: keys }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(keysSerious.map((v) => v.id)).toEqual([]);

	// The key never comes back.
	const read = await (await fetch(`${base}/api/ai/settings`, { headers: { Authorization: adminAuth } })).text();
	expect(read).not.toContain(key);
	expect(JSON.parse(read)).toMatchObject({ kind: 'openai', model: 'local-model', hasKey: true, assistant: true });

	// A domain owner asks, and the guide fits their role.
	const person = await (await browser.newContext()).newPage();
	await person.goto(`/login?login_hint=${encodeURIComponent(owner)}`);
	await person.getByLabel('Account name').fill(owner);
	await person.getByRole('button', { name: 'Continue' }).click();
	await person.getByLabel('Password').fill(password);
	await person.getByRole('button', { name: 'Sign in' }).click();
	await person.waitForURL(/\/manage/, { timeout: 30_000 });
	await person.getByRole('button', { name: 'Ask for help' }).click({ timeout: 30_000 });
	const panel = person.getByRole('complementary', { name: 'Assistant' });
	await panel.getByLabel('Your question').fill('Where do I read my mail?');
	await panel.getByRole('button', { name: 'Ask', exact: true }).click();
	await expect(panel.getByText('Open /mail to read your mail.')).toBeVisible({ timeout: 30_000 });
	const asked = seen.at(-1)!;
	const system = asked.body.messages[0];
	expect(system.role).toBe('system');
	expect(system.content).toContain('Set up your domain');
	expect(system.content).toContain('They are on the page /manage');
	expect(system.content).not.toContain('Watch your server');
	expect(system.content).not.toContain('Running the server');
	expect(asked.body.messages.at(-1)).toEqual({ role: 'user', content: 'Where do I read my mail?' });

	// A follow-up carries the conversation.
	await panel.getByLabel('Your question').fill('And my calendar?');
	await panel.getByRole('button', { name: 'Ask', exact: true }).click();
	await expect(panel.getByText('Open /mail to read your mail.')).toHaveCount(2, { timeout: 30_000 });
	expect(seen.at(-1)!.body.messages.map((item) => item.role)).toEqual(['system', 'user', 'assistant', 'user']);

	// When the service is down, the person is told plainly.
	mode = 'down';
	await panel.getByLabel('Your question').fill('Still there?');
	await panel.getByRole('button', { name: 'Ask', exact: true }).click();
	await expect(panel.getByRole('alert')).toContainText('could not answer', { timeout: 30_000 });
	mode = 'ok';

	// The other kind of service, with its own request shape.
	expect((await settings({ kind: 'anthropic', endpoint: standIn, model: 'a-model', key: `${key}-2`, assistant: true })).status).toBe(200);
	const ask = () =>
		fetch(`${base}/api/assistant`, {
			method: 'POST',
			headers: { Authorization: basic(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages: [{ role: 'user', content: 'Where is my calendar?' }], page: '/mail' })
		});
	expect(((await (await ask()).json()) as { answer: string }).answer).toBe('Open /calendar for that.');
	const anthropic = seen.at(-1)!;
	expect(anthropic).toMatchObject({ path: '/v1/messages', xKey: `${key}-2`, version: '2026-10-21', auth: '' });
	expect(anthropic.body.system).toContain('Set up your domain');
	expect(anthropic.body.max_tokens).toBeGreaterThan(0);
	expect(anthropic.body.messages).toEqual([{ role: 'user', content: 'Where is my calendar?' }]);

	mode = 'refuse';
	expect((await ask()).status).toBe(502);
	mode = 'ok';

	// An empty key keeps the saved one, and turning it off takes it away from everyone.
	expect((await settings({ kind: 'anthropic', endpoint: standIn, model: 'a-model', key: '', assistant: false })).status).toBe(200);
	expect((await (await fetch(`${base}/api/ai/settings`, { headers: { Authorization: adminAuth } })).json()) as { hasKey: boolean }).toMatchObject({ hasKey: true });
	expect((await ask()).status).toBe(409);
	await person.reload();
	await expect(person.getByRole('heading', { name: domain, level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(person.getByRole('button', { name: 'Ask for help' })).toHaveCount(0);
});
