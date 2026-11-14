import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

// Recovering deleted things in a real browser against the local stack: a message
// destroyed for good comes back, and so does a removed account with its mail.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const domain = `recover-${run}.test`;
const password = `Recover check ${run} pw`;
const owner = `owner@${domain}`;
const person = `keep@${domain}`;
const subject = `Worth keeping ${run}`;

function basic(user: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function panel(method: string, path: string, body?: unknown) {
	return fetch(`${base}/api/panel/${path}`, {
		method,
		headers: { Authorization: basic(owner), 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function mailAccount(user: string): Promise<{ status: number; accountId: string }> {
	const res = await fetch(`${base}/jmap/session`, { headers: { Authorization: basic(user) } });
	if (!res.ok) return { status: res.status, accountId: '' };
	const session = (await res.json()) as { primaryAccounts: Record<string, string> };
	return { status: res.status, accountId: session.primaryAccounts['urn:ietf:params:jmap:mail'] };
}

async function mail(user: string, accountId: string, calls: unknown[]) {
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'], methodCalls: calls })
	});
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

async function findMessages(user: string, accountId: string): Promise<string[]> {
	const found = await mail(user, accountId, [['Email/query', { accountId, filter: { subject } }, 'q']]);
	return (found[0][1].ids as string[] | undefined) ?? [];
}

async function adminDestroy(id: string) {
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'],
			methodCalls: [['x:Account/set', { destroy: [id] }, 'd']]
		})
	});
	const reply = (await res.json()) as { methodResponses: [string, { destroyed?: string[] }, string][] };
	expect(reply.methodResponses[0][1].destroyed).toEqual([id]);
}

async function adminFindAccount(name: string): Promise<string> {
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'],
			methodCalls: [['x:Account/query', { filter: { text: name } }, 'q']]
		})
	});
	const reply = (await res.json()) as { methodResponses: [string, { ids?: string[] }, string][] };
	const id = reply.methodResponses[0][1].ids?.[0];
	expect(id).toBeTruthy();
	return id!;
}

function deliver(to: string, title: string): Promise<void> {
	return new Promise((done, fail) => {
		const socket = connect(21025, '127.0.0.1');
		const steps = ['EHLO keeper.test', 'MAIL FROM:<someone@keeper.test>', `RCPT TO:<${to}>`, 'DATA', `From: someone@keeper.test\r\nTo: ${to}\r\nSubject: ${title}\r\n\r\nPlease keep this.\r\n.`, 'QUIT'];
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
	await panel('POST', 'domain/close', { confirm: domain });
});

test('a destroyed message and a removed account are brought back', async ({ page }) => {
	test.setTimeout(240_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);
	expect((await panel('POST', 'mailboxes', { name: 'keep', password })).status).toBe(200);

	// Only administrators reach this.
	expect((await fetch(`${base}/api/recover/accounts`)).status).toBe(401);
	expect((await fetch(`${base}/api/recover/accounts`, { headers: { Authorization: basic(owner) } })).status).toBe(403);

	// A real message arrives, then is destroyed for good.
	await deliver(person, subject);
	const { accountId } = await mailAccount(person);
	await expect.poll(async () => (await findMessages(person, accountId)).length, { timeout: 60_000, intervals: [1_000] }).toBe(1);
	const [emailId] = await findMessages(person, accountId);
	const destroyed = await mail(person, accountId, [['Email/set', { accountId, destroy: [emailId] }, 'd']]);
	expect(destroyed[0][1].destroyed).toEqual([emailId]);
	await expect.poll(async () => (await findMessages(person, accountId)).length, { timeout: 30_000 }).toBe(0);

	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Recover deleted' }).click();
	await expect(page.getByRole('heading', { name: 'Recover deleted', level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/kept for 30 days/)).toBeVisible({ timeout: 30_000 });

	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// The message comes back.
	await page.getByLabel('Person').selectOption({ label: person });
	const kept = page.getByRole('list', { name: 'Deleted messages' }).getByRole('listitem').filter({ hasText: subject });
	await expect(kept).toBeVisible({ timeout: 30_000 });
	await expect(kept.getByText(/From someone@keeper\.test/)).toBeVisible();
	await kept.getByRole('button', { name: `Restore ${subject}` }).click();
	await expect(page.getByText(`${subject} is back in the Inbox.`)).toBeVisible({ timeout: 30_000 });
	await expect(kept).toHaveCount(0);
	await expect.poll(async () => (await findMessages(person, accountId)).length, { timeout: 30_000 }).toBe(1);

	// The account goes: no sign-in, mail refused.
	const accountRecord = await adminFindAccount('keep');
	await adminDestroy(accountRecord);
	await expect.poll(async () => (await mailAccount(person)).status, { timeout: 30_000 }).toBe(401);

	// And comes back, with its mail and password.
	await page.reload();
	const held = page.getByRole('list', { name: 'Deleted accounts' }).getByRole('listitem').filter({ hasText: person });
	await expect(held).toBeVisible({ timeout: 30_000 });
	await expect(held.getByText(/Kept for 30 more days/)).toBeVisible();
	await held.getByRole('button', { name: `Restore ${person}` }).click();
	await expect(page.getByText(`${person} is back.`)).toBeVisible({ timeout: 30_000 });
	await expect(held).toHaveCount(0);
	await expect.poll(async () => (await mailAccount(person)).status, { timeout: 30_000 }).toBe(200);
	await expect.poll(async () => (await findMessages(person, accountId)).length, { timeout: 30_000 }).toBe(1);

	// New mail reaches it again.
	const later = `Still here ${run}`;
	await deliver(person, later);
	await expect
		.poll(
			async () => {
				const found = await mail(person, accountId, [['Email/query', { accountId, filter: { subject: later } }, 'q']]);
				return ((found[0][1].ids as string[] | undefined) ?? []).length;
			},
			{ timeout: 60_000, intervals: [1_000] }
		)
		.toBe(1);

	// An address someone else took in the meantime is refused, in words.
	expect((await panel('POST', 'mailboxes', { name: 'other', password })).status).toBe(200);
	const otherRecord = await adminFindAccount('other');
	await adminDestroy(otherRecord);
	expect((await panel('POST', 'mailboxes', { name: 'other', password })).status).toBe(200);
	const conflict = await fetch(`${base}/api/recover/accounts/${otherRecord}/restore`, { method: 'POST', headers: { Authorization: adminAuth } });
	expect(conflict.status).toBe(409);
	expect(((await conflict.json()) as { message: string }).message).toBe('Someone else has that address now.');
});
