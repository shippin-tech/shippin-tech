import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

// Live tracing on our own endpoints, against the local stack: a real failed
// sign-in shows up in the portal's Live Tracing screen while it streams.
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
// For an unknown domain the server records the domain, so the filter looks for a
// domain made up for this run.
const probeDomain = `${Math.random().toString(16).slice(2, 8)}.tracing.test`;
const probe = `trace-probe@${probeDomain}`;

test('live tracing streams real events with filters, without any licence', async ({ page }) => {
	test.setTimeout(120_000);

	expect((await fetch(`${base}/api/trace/token`)).status).toBe(401);
	const issued = await fetch(`${base}/api/trace/token`, { headers: { Authorization: adminAuth } });
	expect(issued.status).toBe(200);
	const token = (await issued.text()).trim();
	expect(token.length).toBeGreaterThan(20);
	expect((await fetch(`${base}/api/trace/live`)).status).toBe(401);
	expect((await fetch(`${base}/api/trace/live?token=${encodeURIComponent(token)}&level=loud`)).status).toBe(400);

	// The raw stream: it opens with a ready event.
	const raw = await fetch(`${base}/api/trace/live?token=${encodeURIComponent(token)}`);
	expect(raw.headers.get('content-type')).toContain('text/event-stream');
	const reader = raw.body!.getReader();
	const first = new TextDecoder().decode((await reader.read()).value);
	expect(first).toContain('event: ready');
	await reader.cancel();

	const enterprise: string[] = [];
	page.on('request', (request) => {
		if (/\/api\/(token|live)\/tracing/.test(request.url())) enterprise.push(request.url());
	});
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });

	await page.goto('/shippin/admin/tracing');
	await expect(page.getByRole('heading', { name: 'Live Tracing' })).toBeVisible();
	await expect(page.getByText(/requires an Enterprise license/)).toHaveCount(0);
	await page.getByLabel('Detail').selectOption('debug');
	await page.locator('input[name="keywords"]').fill(probeDomain);
	await page.getByRole('button', { name: 'Start tracing' }).click();
	await expect(page.getByText('Streaming events...')).toBeVisible({ timeout: 30_000 });

	// A real event: a failed sign-in by the probe account.
	await expect(async () => {
		const res = await fetch(`${base}/api/account`, {
			headers: { Authorization: 'Basic ' + Buffer.from(`${probe}:wrong`).toString('base64') }
		});
		expect(res.status).toBe(401);
		await expect(page.getByRole('button', { name: 'auth.failed' }).first()).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });

	await page.getByRole('button', { name: 'Stop tracing' }).click();
	await expect(page.getByRole('button', { name: 'Start tracing' })).toBeVisible();
	expect(enterprise).toEqual([]);
});

/** One SMTP conversation with the server's public port. */
function smtpSession(from: string, to: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = connect(21025, '127.0.0.1');
		const steps = ['EHLO tracer.test', `MAIL FROM:<${from}>`, `RCPT TO:<${to}>`, 'QUIT'];
		let replies = 0;
		let buffer = '';
		socket.on('error', reject);
		socket.on('close', () => resolve());
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

test('finished mail sessions are stored and can be searched and opened', async ({ page }) => {
	test.setTimeout(120_000);
	const sender = `history-${Math.random().toString(16).slice(2, 8)}@outside.test`;
	await smtpSession(sender, 'nobody@local.test');

	await expect
		.poll(
			async () => {
				const res = await fetch(`${base}/api/trace/history?q=${encodeURIComponent(sender)}`, { headers: { Authorization: adminAuth } });
				return ((await res.json()) as { traces: { from: string[] }[] }).traces.length;
			},
			{ timeout: 60_000, intervals: [1_000] }
		)
		.toBe(1);
	expect((await fetch(`${base}/api/trace/history`)).status).toBe(401);

	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.goto('/shippin/admin/tracing');
	await page.getByRole('button', { name: 'History' }).click();
	await page.getByRole('searchbox', { name: 'Search' }).fill(sender);
	await page.getByRole('button', { name: 'Search traces' }).click();
	const row = page.getByRole('button', { name: new RegExp(sender) });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	await expect(page.getByRole('region', { name: 'Stored trace' }).getByRole('button', { name: 'smtp.connection-start' })).toBeVisible({ timeout: 30_000 });
});
