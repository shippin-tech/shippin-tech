import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { connect } from 'node:net';

// Masked addresses in a real browser against the local stack: mail to one arrives,
// switching it off refuses mail, and each person only ever reaches their own.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const domain = `masked-${run}.test`;
const password = `Masked check ${run} pw`;
const owner = `owner@${domain}`;
const other = `other@${domain}`;

function basic(user: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function api(method: string, path: string, user: string, body?: unknown) {
	return fetch(`${base}${path}`, {
		method,
		headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

/** Tries to send; returns the server's answer to RCPT TO. */
function deliver(to: string, title: string): Promise<number> {
	return new Promise((done, fail) => {
		const socket = connect(21025, '127.0.0.1');
		const message = `From: someone@shop.test\r\nTo: ${to}\r\nSubject: ${title}\r\n\r\nHello.\r\n.`;
		let step = 0;
		let rcpt = 0;
		let buffer = '';
		socket.on('error', fail);
		socket.on('close', () => done(rcpt));
		socket.on('data', (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split('\r\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (/^\d{3}-/.test(line)) continue;
				step += 1;
				if (step === 1) socket.write('EHLO shop.test\r\n');
				else if (step === 2) socket.write('MAIL FROM:<someone@shop.test>\r\n');
				else if (step === 3) socket.write(`RCPT TO:<${to}>\r\n`);
				else if (step === 4) {
					rcpt = Number(line.slice(0, 3));
					socket.write(rcpt === 250 ? 'DATA\r\n' : 'QUIT\r\n');
				} else if (step === 5 && rcpt === 250) socket.write(`${message}\r\n`);
				else if (step === 6 && rcpt === 250) socket.write('QUIT\r\n');
			}
		});
	});
}

async function arrived(user: string, title: string): Promise<number> {
	const session = (await (await api('GET', '/jmap/session', user)).json()) as { primaryAccounts: Record<string, string> };
	const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
	const res = await api('POST', '/jmap', user, {
		using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
		methodCalls: [['Email/query', { accountId, filter: { subject: title } }, 'q']]
	});
	const reply = (await res.json()) as { methodResponses: [string, { ids?: string[] }, string][] };
	return reply.methodResponses[0][1].ids?.length ?? 0;
}

test.afterAll(async () => {
	await api('POST', '/api/panel/domain/close', owner, { confirm: domain });
});

test('mail to a masked address arrives and stops when it is switched off', async ({ page }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);
	expect((await api('POST', '/api/panel/mailboxes', owner, { name: 'other', password })).status).toBe(200);
	expect((await fetch(`${base}/api/masked`)).status).toBe(401);

	await page.goto(`/login?login_hint=${encodeURIComponent(owner)}`);
	await page.getByLabel('Account name').fill(owner);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });
	await page.goto('/mail');
	await page.getByRole('link', { name: 'Masked addresses' }).click();
	await expect(page.getByRole('heading', { name: 'Masked addresses', level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('complementary', { name: 'Mask your address' }).getByText('0 of 2 done')).toBeVisible({ timeout: 30_000 });

	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	await page.getByLabel('What is it for?').fill('Shops');
	await page.getByRole('button', { name: 'Make an address' }).click();
	const row = page.getByRole('list', { name: 'Your masked addresses' }).getByRole('listitem').filter({ hasText: 'Shops' });
	await expect(row).toBeVisible({ timeout: 30_000 });
	const address = ((await row.getByRole('heading').textContent()) ?? '').trim();
	expect(address).toMatch(new RegExp(`^[a-z2-9]{12}@${domain.replace(/\./g, '\\.')}$`));
	await expect(row.getByText('Delivering to your Inbox')).toBeVisible();

	// Mail arrives in the owner's mailbox.
	const first = `Masked hello ${run}`;
	expect(await deliver(address, first)).toBe(250);
	await expect.poll(() => arrived(owner, first), { timeout: 60_000, intervals: [1_000] }).toBe(1);

	// Nobody else can reach this address.
	const local = address.split('@')[0];
	expect((await api('POST', `/api/masked/${local}`, other, { enabled: false })).status).toBe(404);
	expect((await api('DELETE', `/api/masked/${local}`, other)).status).toBe(404);
	const theirs = (await (await api('GET', '/api/masked', other)).json()) as { addresses: unknown[]; limit: number };
	expect(theirs.addresses).toEqual([]);

	// Switched off, it is refused during the conversation.
	await row.getByRole('checkbox').uncheck();
	await expect(row.getByText(/Switched off/)).toBeVisible({ timeout: 30_000 });
	expect(await deliver(address, `Refused ${run}`)).toBe(550);
	await expect(page.getByRole('complementary', { name: 'Mask your address' }).getByText('All done.')).toBeVisible({ timeout: 30_000 });

	// Switched back on, it works again.
	await row.getByRole('checkbox').check();
	await expect(row.getByText('Delivering to your Inbox')).toBeVisible({ timeout: 30_000 });
	const second = `Masked again ${run}`;
	expect(await deliver(address, second)).toBe(250);
	await expect.poll(() => arrived(owner, second), { timeout: 60_000, intervals: [1_000] }).toBe(1);

	// Removed, the address is gone for good.
	await row.getByRole('button', { name: `Remove ${address}` }).click();
	await row.getByRole('button', { name: `Confirm remove ${address}` }).click();
	await expect(row).toHaveCount(0, { timeout: 30_000 });
	expect(await deliver(address, `Removed ${run}`)).toBe(550);

	// The limit holds.
	let made = 0;
	for (; made <= theirs.limit; made += 1) {
		const res = await api('POST', '/api/masked', other, { label: `Number ${made}` });
		if (res.status !== 200) {
			expect(res.status).toBe(400);
			expect(((await res.json()) as { message: string }).message).toMatch(/limit/);
			break;
		}
	}
	expect(made).toBe(theirs.limit);
});
