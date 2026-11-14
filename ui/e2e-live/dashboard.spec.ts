import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dashboards } from '../src/lib/portal/catalog';

// The administrator dashboard on our own statistics, against the local stack:
// real failed sign-ins are counted by the server, stored by the sampler within
// a couple of minutes, served by /api/stats and drawn by the Svelte dashboard.
// Nothing on the page may touch the enterprise metrics endpoints.
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');

type Stats = {
	period: string;
	step: number;
	points: number;
	node: number | null;
	nodeList: { id: number; hostname: string }[];
	live: Record<string, number>;
	history: Record<string, { kind: string; values: (number | null)[]; total: number | null }>;
};

async function stats(period = '24h'): Promise<Stats> {
	const res = await fetch(`${base}/api/stats?period=${period}`, { headers: { Authorization: adminAuth } });
	expect(res.status).toBe(200);
	return (await res.json()) as Stats;
}

test('dashboard statistics are ours, stored, served and drawn', async ({ page }) => {
	test.setTimeout(300_000);

	// The endpoint: admin only, four periods, live figures from the stores.
	expect((await fetch(`${base}/api/stats`)).status).toBe(401);
	expect((await fetch(`${base}/api/stats?period=1y`, { headers: { Authorization: adminAuth } })).status).toBe(400);
	for (const [period, points, step] of [
		['24h', 24, 3600],
		['7d', 28, 21600],
		['30d', 30, 86400],
		['90d', 90, 86400]
	] as const) {
		const answer = await stats(period);
		expect([answer.period, answer.points, answer.step]).toEqual([period, points, step]);
	}
	const now = Math.floor(Date.now() / 1000);
	const custom = await fetch(`${base}/api/stats?from=${now - 30 * 3600}&to=${now}`, { headers: { Authorization: adminAuth } });
	expect(custom.status).toBe(200);
	expect(await custom.json()).toMatchObject({ period: 'custom', step: 3600 });
	const backwards = await fetch(`${base}/api/stats?from=${now}&to=${now - 3600}`, { headers: { Authorization: adminAuth } });
	expect(backwards.status).toBe(400);

	const before = await stats();
	expect(before.nodeList.length).toBeGreaterThanOrEqual(1);
	const one = before.nodeList[0];
	const single = await fetch(`${base}/api/stats?period=24h&node=${one.id}`, { headers: { Authorization: adminAuth } });
	expect(((await single.json()) as Stats).node).toBe(one.id);
	expect(before.live['user.count']).toBeGreaterThanOrEqual(1);
	expect(before.live['domain.count']).toBeGreaterThanOrEqual(1);
	expect(before.live['queue.count']).toBeGreaterThanOrEqual(0);
	const failedBefore = before.history['auth.failed']?.total ?? 0;

	// Real events: three failed sign-ins.
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${base}/api/account`, {
			headers: { Authorization: 'Basic ' + Buffer.from(`nobody-${attempt}@dashboard.test:wrong`).toString('base64') }
		});
		expect(res.status).toBe(401);
	}

	// The sampler stores them within its one-minute cycle.
	await expect
		.poll(async () => (await stats()).history['auth.failed']?.total ?? 0, { timeout: 150_000, intervals: [5_000] })
		.toBeGreaterThanOrEqual(failedBefore + 3);
	const after = await stats();
	expect(after.history['auth.failed'].kind).toBe('count');
	expect(after.history['auth.failed'].values.length).toBe(24);

	// The page.
	const enterprise: string[] = [];
	page.on('request', (request) => {
		if (/\/api\/(token|live)\/metrics/.test(request.url())) enterprise.push(request.url());
	});
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.evaluate(() => localStorage.removeItem('dashboard:prefs'));
	await page.goto('/shippin/admin');

	await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({ timeout: 30_000 });
	const tabs = page.getByRole('tablist', { name: 'Dashboard sections' }).getByRole('tab');
	await expect(tabs).toHaveText(['Overview', 'Network', 'Security', 'Delivery', 'Performance', 'Storage', 'All metrics']);

	const users = page.getByRole('region', { name: 'Total Users' });
	await expect(users.locator('.value')).toHaveText(String(after.live['user.count']));
	await expect(page.getByRole('region', { name: 'Messages', exact: true })).toBeVisible();

	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	await page.getByRole('tab', { name: 'Security' }).click();
	const failures = page.getByRole('region', { name: 'Auth Failures' }).locator('.value');
	await expect(failures).not.toHaveText('0');
	const shown = Number((await failures.innerText()).replace(/[^0-9]/g, ''));
	expect(shown).toBeGreaterThanOrEqual(failedBefore + 3);

	// Keyboard readout on a chart.
	const chart = page.getByRole('slider', { name: 'Fail-to-ban, by time' });
	await chart.focus();
	const last = await chart.getAttribute('aria-valuetext');
	await chart.press('ArrowLeft');
	await expect(chart).not.toHaveAttribute('aria-valuetext', last ?? '');

	// Every option: any recorded metric can be charted.
	await page.getByRole('tab', { name: 'All metrics' }).click();
	await page.getByLabel('Filter metrics').fill('auth.failed');
	const row = page.getByRole('row', { name: /auth\.failed/ });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Chart' }).click();
	await expect(page.getByRole('slider', { name: 'auth.failed, by time' })).toBeVisible();

	// Periods, a custom range, one node, and chart style.
	await page.getByRole('button', { name: 'Last 7 days' }).click();
	await page.getByRole('tab', { name: 'Overview' }).click();
	await page.getByRole('button', { name: 'Lines' }).click();
	await expect(page.getByRole('slider', { name: 'Messages, by time' })).toBeVisible();

	await page.getByRole('button', { name: 'Custom range' }).click();
	const form = page.getByRole('form', { name: 'Custom range' });
	await expect(form.getByLabel('From')).not.toHaveValue('');
	await form.getByRole('button', { name: 'Show range' }).click();
	await expect(page.getByText(/^Showing /)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Custom range' })).toHaveAttribute('aria-pressed', 'true');

	const nodes = page.getByLabel('Node');
	await expect(nodes.getByRole('option')).toHaveCount(before.nodeList.length + 1);
	await nodes.selectOption(String(one.id));
	await expect(page.getByRole('region', { name: 'Total Users' }).locator('.value')).toHaveText(
		String(after.live['user.count'])
	);

	expect(enterprise).toEqual([]);
});

test('every tab, card and chart of the dashboard definition is on the page', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.evaluate(() => localStorage.removeItem('dashboard:prefs'));
	await page.goto('/shippin/admin');
	await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({ timeout: 30_000 });

	let cards = 0;
	let charts = 0;
	for (const tab of dashboards) {
		await page.getByRole('tab', { name: tab.label, exact: true }).click();
		const panel = page.getByRole('tabpanel');
		const names = new Map<string, number>();
		for (const item of [...tab.cards, ...tab.charts]) names.set(item.title, (names.get(item.title) ?? 0) + 1);
		for (const [name, count] of names) {
			await expect(panel.getByRole('region', { name, exact: true }), `${tab.label}: ${name}`).toHaveCount(count);
		}
		for (const card of tab.cards) {
			const region = panel.locator('section.card', { has: page.getByRole('heading', { name: card.title, exact: true }) });
			await expect(region.locator('.value'), `${tab.label}: ${card.title} value`).not.toHaveText('');
		}
		for (const chart of tab.charts) {
			await expect(panel.getByRole('slider', { name: `${chart.title}, by time` }), `${tab.label}: ${chart.title}`).toHaveCount(
				tab.charts.filter((other) => other.title === chart.title).length
			);
		}
		cards += tab.cards.length;
		charts += tab.charts.length;
	}
	expect([dashboards.length, cards, charts]).toEqual([6, 37, 15]);
});
