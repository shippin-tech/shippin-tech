import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

// Alerts in a real browser against the local stack: a rule the administrator writes
// fires, reaches a real webhook and a real mailbox, then waits out its cooldown.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const domain = `alerts-${run}.test`;
const password = `Alerts check ${run} pw`;
const owner = `owner@${domain}`;
const ownerAuth = 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64');
const name = `Domains exist ${run}`;

type Hook = { alert: string; metric: string; value: number; threshold: number; above: boolean; window: string; server: string; at: number };
type Rule = { id: string; name: string; enabled: boolean; threshold: number; lastFired: number | null; lastValue: number | null };

const hooks: Hook[] = [];
const receiver = createServer((req, res) => {
	let body = '';
	req.on('data', (chunk) => (body += chunk));
	req.on('end', () => {
		if (req.headers['content-type'] === 'application/json') hooks.push(JSON.parse(body) as Hook);
		res.end('ok');
	});
});

test.beforeAll(async () => {
	await new Promise<void>((done) => receiver.listen(28026, '0.0.0.0', done));
});

test.afterAll(async () => {
	receiver.close();
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: ownerAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: domain })
	});
});

async function alerts(method: string, path = '', body?: unknown, auth = adminAuth) {
	return fetch(`${base}/api/alerts${path}`, {
		method,
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function ours(): Promise<Rule | undefined> {
	const { rules } = (await (await alerts('GET')).json()) as { rules: Rule[] };
	return rules.find((rule) => rule.name === name);
}

async function inboxSubjects(): Promise<string[]> {
	const session = (await (await fetch(`${base}/jmap/session`, { headers: { Authorization: ownerAuth } })).json()) as { primaryAccounts: Record<string, string> };
	const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: ownerAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
			methodCalls: [
				['Email/query', { accountId }, 'q'],
				['Email/get', { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['subject'] }, 'g']
			]
		})
	});
	const reply = (await res.json()) as { methodResponses: [string, { list?: { subject: string }[] }, string][] };
	return (reply.methodResponses[1][1].list ?? []).map((email) => email.subject);
}

test('an alert fires to a real webhook and mailbox, then waits out its cooldown', async ({ page }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);

	// Only administrators reach alerts.
	expect((await fetch(`${base}/api/alerts`)).status).toBe(401);
	expect((await alerts('GET', '', undefined, ownerAuth)).status).toBe(403);

	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });

	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Alerts' }).click();
	await expect(page.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('complementary', { name: 'Watch your server' })).toBeVisible();

	// A form that is wrong says why, here and on the server.
	await page.getByRole('button', { name: 'New alert' }).click();
	const form = page.getByRole('form', { name: 'New alert' });
	await form.getByRole('button', { name: 'Save alert' }).click();
	await expect(form.getByRole('alert')).toHaveText('Give the alert a name.');
	const refused = await alerts('POST', '', { name: 'Bad', metric: 'not.a-metric', window: '1h', above: true, threshold: 1, email: ['a@b.co'] });
	expect(refused.status).toBe(400);
	expect(((await refused.json()) as { message: string }).message).toMatch(/metric/);

	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	await form.getByLabel('Name').fill(name);
	await form.getByLabel('Metric').fill('domain.count');
	await form.getByLabel('Threshold').fill('0');
	await form.getByLabel('Email to').fill(owner);
	await form.getByLabel('Webhook address').fill('http://host.docker.internal:28026/hook');
	await form.getByRole('button', { name: 'Save alert' }).click();
	const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });
	await expect(item.getByText('domain.count above 0 over the last hour')).toBeVisible({ timeout: 30_000 });
	await expect(item.getByText('Not sent yet')).toBeVisible();

	// It fires: the webhook call and the email both arrive.
	await page.getByRole('button', { name: 'Check now' }).click();
	await expect(page.getByText(/^Checked \d+ alerts?, \d+ sent\.$/)).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => hooks.filter((hook) => hook.alert === name).length, { timeout: 30_000 }).toBe(1);
	const hook = hooks.find((item) => item.alert === name)!;
	expect(hook).toMatchObject({ metric: 'domain.count', threshold: 0, above: true, window: '1h' });
	expect(hook.value).toBeGreaterThan(0);
	await expect.poll(inboxSubjects, { timeout: 60_000, intervals: [1_000] }).toContain(`Alert: ${name}`);
	await expect(item.getByText(/^Latest value \d+\. Last sent /)).toBeVisible({ timeout: 30_000 });

	// It does not fire again during its cooldown.
	const firstFired = (await ours())!.lastFired;
	expect(firstFired).not.toBeNull();
	const second = (await (await alerts('POST', '/check')).json()) as { results: { id: string; fired: boolean }[] };
	const rule = (await ours())!;
	expect(second.results.find((result) => result.id === rule.id)?.fired).toBe(false);
	expect(rule.lastFired).toBe(firstFired);
	expect(hooks.filter((item) => item.alert === name).length).toBe(1);

	// Editing keeps its history; turning it off takes it out of the check.
	await item.getByRole('button', { name: `Edit ${name}` }).click();
	const edit = page.getByRole('form', { name: 'Edit alert' });
	await edit.getByLabel('Threshold').fill('5000000');
	await edit.getByRole('button', { name: 'Save alert' }).click();
	await expect(item.getByText('domain.count above 5000000 over the last hour')).toBeVisible({ timeout: 30_000 });
	expect((await ours())!.lastFired).toBe(firstFired);

	await item.getByRole('checkbox').uncheck();
	await expect.poll(async () => (await ours())!.enabled, { timeout: 30_000 }).toBe(false);
	const third = (await (await alerts('POST', '/check')).json()) as { results: { id: string }[] };
	expect(third.results.some((result) => result.id === rule.id)).toBe(false);

	await item.getByRole('button', { name: `Remove ${name}` }).click();
	await item.getByRole('button', { name: `Confirm remove ${name}` }).click();
	await expect(item).toHaveCount(0, { timeout: 30_000 });
	expect(await ours()).toBeUndefined();
});
