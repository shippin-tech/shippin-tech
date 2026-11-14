import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

// The Resources page in a real browser against the local stack: real mail stored by one
// organisation shows up as that organisation's real storage, and nobody else can look.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const password = `Resources check ${run} pw`;
const hill = `hill-${run}.test`;
const owner = `owner@${hill}`;
const orgName = `Hill Farm ${run}`;

type Usage = { id: string; name: string; people: number; maxPeople: number; storageUsed: number; storageLevel: string };
type Report = { server: { host: string; domains: number; people: number; disk: unknown }; orgs: Usage[]; other: { domains: number } };

function basic(user: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

const report = async (): Promise<Report> => (await (await fetch(`${base}/api/resources`, { headers: { Authorization: adminAuth } })).json()) as Report;
const ours = async () => (await report()).orgs.find((org) => org.name === orgName);

function deliver(to: string, title: string): Promise<void> {
	return new Promise((done, fail) => {
		const socket = connect(21025, '127.0.0.1');
		const body = 'A real message with some weight to it. '.repeat(200);
		const steps = ['EHLO weight.test', 'MAIL FROM:<someone@weight.test>', `RCPT TO:<${to}>`, 'DATA', `From: someone@weight.test\r\nTo: ${to}\r\nSubject: ${title}\r\n\r\n${body}\r\n.`, 'QUIT'];
		let replies = 0;
		let buffer = '';
		socket.on('error', fail);
		socket.on('close', () => done());
		socket.on('data', (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split('\r\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (/^\d{3}-/.test(line)) continue;
				if (replies < steps.length) socket.write(`${steps[replies]}\r\n`);
				replies += 1;
			}
		});
	});
}

test.afterAll(async () => {
	const org = await ours();
	if (org) await fetch(`${base}/api/orgs/${org.id}`, { method: 'DELETE', headers: { Authorization: adminAuth } });
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: basic(owner), 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: hill })
	});
});

test('real stored mail shows as that organisation using real storage', async ({ page }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain: hill, name: 'owner', password })
	});
	expect(created.status).toBe(200);

	expect((await fetch(`${base}/api/resources`)).status).toBe(401);
	expect((await fetch(`${base}/api/resources`, { headers: { Authorization: basic(owner) } })).status).toBe(403);

	const domains = (await (await fetch(`${base}/api/orgs`, { headers: { Authorization: adminAuth } })).json()) as { domains: { id: string; name: string }[] };
	const domainId = domains.domains.find((item) => item.name === hill)!.id;
	const saved = await fetch(`${base}/api/orgs`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: orgName, domains: [domainId], admins: [owner], maxPeople: 2, maxStorageGb: 1 })
	});
	expect(saved.status).toBe(200);

	// An organisation administrator still cannot see the whole server.
	expect((await fetch(`${base}/api/resources`, { headers: { Authorization: basic(owner) } })).status).toBe(403);

	const before = (await ours())!;
	expect(before).toMatchObject({ people: 1, maxPeople: 2 });
	expect(before.storageUsed).toBe(0);

	await deliver(owner, `Weighing in ${run}`);
	await expect.poll(async () => (await ours())!.storageUsed, { timeout: 60_000, intervals: [1_000] }).toBeGreaterThan(5000);

	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Resources' }).click();
	await expect(page.getByRole('heading', { name: 'Resources', level: 1 })).toBeVisible({ timeout: 30_000 });

	const row = page.getByRole('list', { name: 'Organisation usage' }).getByRole('listitem').filter({ hasText: orgName });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(row.getByText('1 of 2')).toBeVisible();
	await expect(row.getByText(/KB of 1\.0 GB/)).toBeVisible();

	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	const whole = await report();
	expect(whole.server.domains).toBeGreaterThan(0);
	expect(whole.server.host).toBeTruthy();
});
