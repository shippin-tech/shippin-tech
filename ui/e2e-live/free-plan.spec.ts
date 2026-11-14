import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// One customer's whole journey in a real browser against the local stack:
// sign up, sign in, manage the domain, secure the account, send and reply to mail.
test.describe.configure({ mode: 'serial' });

const run = Math.random().toString(16).slice(2, 8);
const domain = `ui-${run}.test`;
const owner = `owner@${domain}`;
const password = `Browser check ${run} pw`;
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';

async function adminJmap(calls: unknown[]) {
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: calls })
	});
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

async function accessible(page: Page, label: string) {
	const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
	const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(serious.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => `${n.target.join(' ')} -> ${n.failureSummary}`).join(' | ')}`)).toEqual([]);
}

async function signIn(page: Page) {
	await page.goto(`/login?login_hint=${encodeURIComponent(owner)}`);
	await page.getByLabel('Account name').fill(owner);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });
}

test.afterAll(async () => {
	const found = await adminJmap([
		['x:Domain/query', {}, 'q'],
		['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'g']
	]);
	const ids = ((found[1][1].list as { id: string; name: string }[]) ?? []).filter((d) => d.name === domain).map((d) => d.id);
	if (!ids.length) return;
	const accounts = await adminJmap([['x:Account/query', { filter: { domainId: ids[0] } }, 'q']]);
	const accountIds = (accounts[0][1].ids as string[]) ?? [];
	if (accountIds.length) await adminJmap([['x:Account/set', { destroy: accountIds }, 'a']]);
	const keys = await adminJmap([
		['x:DkimSignature/query', {}, 'q'],
		['x:DkimSignature/get', { '#ids': { resultOf: 'q', name: 'x:DkimSignature/query', path: '/ids' }, properties: ['id', 'domainId'] }, 'g']
	]);
	const doomed = ((keys[1][1].list as { id: string; domainId: string }[]) ?? []).filter((k) => ids.includes(k.domainId)).map((k) => k.id);
	if (doomed.length) await adminJmap([['x:DkimSignature/set', { destroy: doomed }, 'k']]);
	await adminJmap([['x:Domain/set', { destroy: ids }, 'd']]);
});

test('a visitor signs up with their own domain', async ({ page }) => {
	await page.goto('/signup');
	await expect(page.getByRole('heading', { name: 'Create your free mail account' })).toBeVisible();
	await expect(page.getByText(/free plan includes 3 mailboxes/)).toBeVisible();
	await accessible(page, 'signup');
	await page.getByLabel('Domain').fill(domain);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText('_shippin-verify', { exact: true })).toBeVisible();
	// The value comes from the domain-proof service's own key, made once and then kept.
	const proof = async () =>
		(
			(await (
				await fetch(`${base}/api/panel/signup/code`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ domain })
				})
			).json()) as { record: { value: string } }
		).record.value;
	const first = await proof();
	expect(first).toMatch(/^shippin-verify=[0-9a-f]{32}$/);
	expect(await proof()).toBe(first);
	await page.getByLabel('Your address').fill('owner');
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Repeat password').fill(password);
	await page.getByRole('button', { name: 'Verify and create' }).click();
	await expect(page.getByText(`${owner} is ready.`)).toBeVisible();
});

test('the owner signs in and lands on their domain', async ({ page }) => {
	await signIn(page);
	await expect(page.getByRole('heading', { name: domain })).toBeVisible();
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link', { name: 'My domain' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Account' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
	// MX, SPF, DMARC and two DKIM keys (RSA and Ed25519); .test domains have no public DNS.
	await expect(page.getByText(/0 of 5 required records are published/)).toBeVisible({ timeout: 30_000 });
	await accessible(page, 'manage');

	// The MCPL lesson starts untouched; DNS cannot be published for a .test domain.
	const lesson = page.getByRole('complementary', { name: 'Set up your domain' });
	await expect(lesson).toBeVisible();
	await expect(lesson.getByText('0 of 4 done')).toBeVisible();

	await page.getByLabel('Address', { exact: true }).fill('sales');
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Create mailbox' }).click();
	await expect(page.getByText(`sales@${domain} was created.`)).toBeVisible();
	await expect(page.getByRole('rowheader', { name: `sales@${domain}` })).toBeVisible();

	// The real panel.mailbox.created event finished exactly that step.
	await expect(lesson.getByText('1 of 4 done')).toBeVisible();
	await expect(lesson.locator('li[data-state="done"]')).toHaveText(/Add a mailbox for someone on your team/);
	await expect(lesson.locator('li[aria-current="step"]')).toHaveText(/Publish the DNS records/);
});

test('the owner creates an app password on the account page', async ({ page }) => {
	await signIn(page);
	await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Account security' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('Off. Turn it on')).toBeVisible();
	await accessible(page, 'account');
	await page.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
	await expect(page.locator('.qr svg')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.getByLabel('Name').fill('Phone');
	await page.getByRole('button', { name: 'Create app password' }).click();
	await expect(page.getByText('New app password for Phone')).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Phone' })).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'About this key' })).toContainText('This password was made for you. Paste it into your mail app.');
	await accessible(page, 'app password');

	// Shown once: the server keeps only a hash, so reading the list never gives it back.
	const secret = ((await page.locator('code.secret').textContent()) ?? '').trim();
	expect(secret.length).toBeGreaterThan(10);
	const listed = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64'), 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:shippin.tech:jmap'], methodCalls: [['x:AppPassword/query', {}, 'q'], ['x:AppPassword/get', { '#ids': { resultOf: 'q', name: 'x:AppPassword/query', path: '/ids' } }, 'g']] })
	});
	const text = await listed.text();
	expect(text).toContain('Phone');
	expect(text).not.toContain(secret);
});

test('the owner sends a message, receives it and replies', async ({ page }) => {
	const subject = `Browser send ${run}`;
	await signIn(page);
	await page.goto('/mail');
	await page.getByRole('link', { name: 'Compose' }).click();
	await expect(page.getByRole('heading', { name: 'New message' })).toBeVisible();
	await accessible(page, 'compose');
	await page.getByLabel('To', { exact: true }).fill(`sales@${domain}, ${owner}`);
	await page.getByLabel('Subject', { exact: true }).fill(subject);
	await page.getByLabel('Message', { exact: true }).fill('Sent from the browser test.');
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByText('Message sent.')).toBeVisible({ timeout: 30_000 });

	// The send finished the lesson's "send your first message" step. This is a fresh
	// browser session, so the mailbox step it also shows came from the server, where
	// the earlier session stored it: lesson progress follows the person.
	await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My domain' }).click();
	const lesson = page.getByRole('complementary', { name: 'Set up your domain' });
	await expect(lesson.getByText('2 of 4 done')).toBeVisible();
	await expect(lesson.locator('li[data-state="done"]')).toHaveText([
		/Add a mailbox for someone on your team/,
		/Send your first message/
	]);
	const ownerAuth = 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64');
	await expect
		.poll(async () => {
			const res = await fetch(`${base}/api/learn/progress`, { headers: { Authorization: ownerAuth } });
			const body = (await res.json()) as { lessons: Record<string, { done: string[] }> };
			return [...(body.lessons['set-up-your-domain']?.done ?? [])].sort();
		})
		.toEqual(['add-mailbox', 'send-first-message']);

	// It arrives in the inbox; reload until delivery completes.
	await expect(async () => {
		await page.goto('/mail');
		await expect(page.getByRole('link', { name: new RegExp(subject) })).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 60_000 });
	await page.getByRole('link', { name: new RegExp(subject) }).first().click();
	await expect(page.getByRole('heading', { name: subject })).toBeVisible();
	await page.getByRole('link', { name: 'Reply', exact: true }).click();
	await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(`Re: ${subject}`);
	await expect(page.getByLabel('Message', { exact: true })).toHaveValue(/> Sent from the browser test\./);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByText('Message sent.')).toBeVisible({ timeout: 30_000 });

	// Sent holds both messages and Drafts holds neither.
	await page.getByRole('button', { name: /^Sent/ }).click();
	await expect(page.getByRole('link', { name: new RegExp(`Re: ${subject}`) })).toBeVisible();
	await page.getByRole('button', { name: /^Drafts/ }).click();
	await expect(page.getByRole('link', { name: new RegExp(subject) })).toHaveCount(0);
});

test('an attachment survives the round trip', async ({ page }) => {
	const subject = `Attachment ${run}`;
	const content = `Attachment body ${run}
`;
	await signIn(page);
	await page.goto('/mail/compose');
	await page.getByLabel('To', { exact: true }).fill(owner);
	await page.getByLabel('Subject', { exact: true }).fill(subject);
	await page.getByLabel('Message', { exact: true }).fill('See the attached file.');
	await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(content) });
	await expect(page.getByRole('list', { name: 'Attachments' }).getByText('notes.txt')).toBeVisible();
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByText('Message sent.')).toBeVisible({ timeout: 30_000 });

	await expect(async () => {
		await page.goto('/mail');
		await expect(page.getByRole('link', { name: new RegExp(subject) })).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 60_000 });
	await page.getByRole('link', { name: new RegExp(subject) }).first().click();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'notes.txt' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('notes.txt');
	const saved = await file.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of saved) chunks.push(chunk as Buffer);
	expect(Buffer.concat(chunks).toString()).toBe(content);
});

test('the owner closes the domain from the page', async ({ page }) => {
	await signIn(page);
	const confirm = page.getByLabel(`Type ${domain} to confirm`);
	await confirm.fill('wrong.test');
	await page.getByRole('button', { name: 'Close domain and delete all mail' }).click();
	await expect(page.getByText(`Type ${domain} to confirm.`)).toBeVisible();
	await confirm.fill(domain);
	await page.getByRole('button', { name: 'Close domain and delete all mail' }).click();
	await page.waitForURL(/\/login\?closed=1/, { timeout: 30_000 });
	await expect(page.getByText('Your domain was closed and its mail deleted.')).toBeVisible();
	const res = await fetch(`${base}/jmap/session`, {
		headers: { Authorization: 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64') }
	});
	expect(res.status).toBe(401);
});
