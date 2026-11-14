import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Domain logos in a real browser against the local stack: each domain's sign-in and
// webmail show its own, and only someone who manages the domain can change it.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const password = `Brand check ${run} pw`;
const hill = `hill-${run}.test`;
const vale = `vale-${run}.test`;
const hillBoss = `owner@${hill}`;
const valeBoss = `owner@${vale}`;

// A real 1 by 1 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function basic(user: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function signup(domain: string) {
	const res = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(res.status).toBe(200);
}

function send(path: string, method: string, user: string | null, body?: BodyInit) {
	return fetch(`${base}${path}`, { method, headers: user ? { Authorization: basic(user) } : {}, body });
}

test.afterEach(async ({ browser }) => {
	await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
	for (const [user, domain] of [[hillBoss, hill], [valeBoss, vale]]) {
		await fetch(`${base}/api/panel/domain/close`, {
			method: 'POST',
			headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: domain })
		});
	}
});

test('each domain shows its own logo and only its manager can change it', async ({ page, browser }) => {
	test.setTimeout(180_000);
	await signup(hill);
	await signup(vale);
	expect((await send(`/api/brand/${hill}`, 'GET', null)).status).toBe(404);

	// The owner uploads one in the browser.
	await page.goto(`/login?login_hint=${encodeURIComponent(hillBoss)}`);
	await page.getByLabel('Account name').fill(hillBoss);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });
	await expect(page.getByText(`No logo for ${hill}`)).toBeVisible({ timeout: 30_000 });
	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
	await page.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
	await expect(page.getByRole('main').getByRole('img', { name: `${hill} logo` })).toBeVisible({ timeout: 30_000 });

	// Anyone can fetch it, safely typed.
	const fetched = await send(`/api/brand/${hill}`, 'GET', null);
	expect(fetched.status).toBe(200);
	expect(fetched.headers.get('content-type')).toBe('image/png');
	expect(fetched.headers.get('x-content-type-options')).toBe('nosniff');
	expect(Buffer.from(await fetched.arrayBuffer()).equals(png)).toBe(true);

	// Webmail shows it to this domain's people.
	await page.goto('/mail');
	await expect(page.getByRole('banner').getByRole('img', { name: `${hill} logo` })).toBeVisible({ timeout: 30_000 });

	// Nobody else can change it, and scripts cannot get in as logos.
	expect((await send(`/api/brand/${hill}`, 'POST', null, png)).status).toBe(401);
	expect((await send(`/api/brand/${hill}`, 'POST', valeBoss, png)).status).toBe(403);
	expect((await send(`/api/brand/${hill}`, 'DELETE', valeBoss)).status).toBe(403);
	const svg = await send(`/api/brand/${vale}`, 'POST', valeBoss, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
	expect(svg.status).toBe(400);
	expect(((await svg.json()) as { message: string }).message).toMatch(/PNG/);
	expect((await send(`/api/brand/${vale}`, 'POST', valeBoss, Buffer.concat([png, Buffer.alloc(95_000)]))).status).toBe(400);
	expect((await send(`/api/brand/${vale}`, 'GET', null)).status).toBe(404);

	// A signed-out visitor sees each domain's own sign-in.
	const visitor = await (await browser.newContext()).newPage();
	await visitor.goto(`/login?login_hint=${encodeURIComponent(hillBoss)}`);
	await visitor.getByLabel('Account name').fill(hillBoss);
	await expect(visitor.locator('form').getByRole('img', { name: `${hill} logo`, includeHidden: true })).toBeVisible({ timeout: 30_000 });
	await visitor.getByLabel('Account name').fill(valeBoss);
	await expect(visitor.locator('form').getByRole('img', { name: `${vale} logo`, includeHidden: true })).toHaveCount(0, { timeout: 30_000 });
	await expect(visitor.locator('form').getByRole('img', { name: `${hill} logo`, includeHidden: true })).toHaveCount(0);

	// Removed, it is gone.
	await page.goto('/manage');
	await page.getByRole('button', { name: `Remove logo for ${hill}` }).click();
	await expect(page.getByText(`No logo for ${hill}`)).toBeVisible({ timeout: 30_000 });
	expect((await send(`/api/brand/${hill}`, 'GET', null)).status).toBe(404);
});
