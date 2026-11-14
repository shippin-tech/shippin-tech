import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Signing in through a domain's own identity provider, in a real browser against the
// local stack, with a stand-in provider on the host. Each attack here is one the server
// must refuse: another domain's address, an unverified one, an administrator, a replay.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const password = `Sso check ${run} pw`;
const hill = `hill-${run}.test`;
const vale = `vale-${run}.test`;
const hillBoss = `owner@${hill}`;
const valeBoss = `owner@${vale}`;
const issuer = 'http://host.docker.internal:28027';
const clientSecret = `provider-secret-${run}`;

// What the provider will say about whoever signs in next.
let identity: { email?: string; email_verified?: boolean } = {};
const seen: { secret?: string; verified?: boolean; state?: string; code?: string } = {};
let challenge = '';

const provider = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://127.0.0.1:28027');
	let body = '';
	req.on('data', (chunk) => (body += chunk));
	req.on('end', () => {
		res.setHeader('Content-Type', 'application/json');
		if (url.pathname === '/.well-known/openid-configuration') {
			res.end(JSON.stringify({ issuer, authorization_endpoint: 'http://127.0.0.1:28027/authorize', token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo` }));
		} else if (url.pathname === '/authorize') {
			challenge = url.searchParams.get('code_challenge') ?? '';
			seen.state = url.searchParams.get('state') ?? '';
			seen.code = `code-${Math.random()}`;
			res.statusCode = 302;
			res.setHeader('Location', `${url.searchParams.get('redirect_uri')}?code=${seen.code}&state=${seen.state}`);
			res.end();
		} else if (url.pathname === '/token') {
			const form = new URLSearchParams(body);
			seen.secret = form.get('client_secret') ?? '';
			seen.verified = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === challenge;
			res.end(JSON.stringify({ access_token: 'provider-access', token_type: 'Bearer' }));
		} else if (url.pathname === '/userinfo') {
			res.end(JSON.stringify(identity));
		} else {
			res.statusCode = 404;
			res.end('{}');
		}
	});
});

test.beforeAll(async () => {
	await new Promise<void>((done) => provider.listen(28027, '0.0.0.0', done));
});

test.afterEach(async ({ browser }) => {
	await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
	provider.close();
	for (const [user, domain] of [[hillBoss, hill], [valeBoss, vale]]) {
		await fetch(`${base}/api/panel/domain/close`, {
			method: 'POST',
			headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: domain })
		});
	}
});

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

async function toPasswordStep(page: Page, account: string) {
	await page.goto(`/login?login_hint=${encodeURIComponent(account)}`);
	await page.getByLabel('Account name').fill(account);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByLabel('Password')).toBeVisible({ timeout: 30_000 });
}

const button = (page: Page) => page.getByRole('button', { name: 'Use your organisation sign-in' });
const refused = (page: Page) => expect(page.getByText('Your organisation sign-in did not work')).toBeVisible({ timeout: 30_000 });

test('people sign in through their domain provider and nobody else can', async ({ browser }) => {
	test.setTimeout(240_000);
	await signup(hill);
	await signup(vale);
	expect((await (await fetch(`${base}/api/sso/${hill}`)).json()) as unknown).toEqual({ enabled: false });

	// Only someone who manages the domain sets it up.
	const settings = `/api/sso/${hill}/settings`;
	const form = JSON.stringify({ issuer, clientId: 'shippin', clientSecret, enabled: true });
	const json = { 'Content-Type': 'application/json' };
	expect((await fetch(`${base}${settings}`, { method: 'POST', headers: json, body: form })).status).toBe(401);
	expect((await fetch(`${base}${settings}`, { method: 'POST', headers: { ...json, Authorization: basic(valeBoss) }, body: form })).status).toBe(403);

	const context = await browser.newContext();
	const page = await context.newPage();
	await toPasswordStep(page, hillBoss);
	await expect(button(page)).toHaveCount(0);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });
	await page.getByRole('button', { name: `Set up sign-in for ${hill}` }).click();
	const editor = page.getByRole('form', { name: `Sign-in for ${hill}` });
	await expect(editor.getByText('/api/sso/callback')).toBeVisible({ timeout: 30_000 });
	await editor.getByRole('button', { name: 'Save sign-in' }).click();
	await expect(editor.getByRole('alert')).toContainText('provider address');
	await editor.getByLabel('Provider address').fill(issuer);
	await editor.getByLabel('Client ID').fill('shippin');
	await editor.getByLabel('Client secret').fill(clientSecret);
	await expect(editor.getByRole('complementary', { name: 'About this key' })).toContainText('Paste your client secret here. This is the right place for it.');
	await editor.getByLabel('Offer this sign-in').check();
	await editor.getByRole('button', { name: 'Save sign-in' }).click();
	await expect(page.getByText(`signs in through ${issuer}`)).toBeVisible({ timeout: 30_000 });

	// The secret never comes back.
	const read = await (await fetch(`${base}${settings}`, { headers: { Authorization: basic(hillBoss) } })).text();
	expect(read).not.toContain(clientSecret);
	expect(JSON.parse(read)).toMatchObject({ issuer, clientId: 'shippin', hasSecret: true, enabled: true });

	// The real thing: straight through the provider, no password.
	const person = await (await browser.newContext()).newPage();
	identity = { email: hillBoss, email_verified: true };
	await toPasswordStep(person, hillBoss);
	await button(person).click();
	await person.waitForURL(/\/manage/, { timeout: 30_000 });
	await expect(person.getByRole('heading', { name: hill, level: 1 })).toBeVisible({ timeout: 30_000 });
	expect(seen.secret).toBe(clientSecret);
	expect(seen.verified).toBe(true);

	// A used sign-in cannot be replayed.
	const replay = await fetch(`${base}/api/sso/callback?code=${seen.code}&state=${seen.state}`, { redirect: 'manual' });
	expect(replay.status).toBe(302);
	expect(replay.headers.get('location')).toBe('/login?sso=failed');

	// The provider is only believed about its own domain.
	const attacks: { email?: string; email_verified?: boolean }[] = [
		{ email: valeBoss, email_verified: true },
		{ email: hillBoss, email_verified: false },
		{ email: `nobody@${hill}`, email_verified: true },
		{}
	];
	for (const attack of attacks) {
		identity = attack;
		const page2 = await (await browser.newContext()).newPage();
		await toPasswordStep(page2, hillBoss);
		await button(page2).click();
		await refused(page2);
		await expect(page2).toHaveURL(/\/login/);
		await page2.context().close();
	}

	// A server administrator on the domain can never come in this way.
	const domains = (await (await fetch(`${base}/api/orgs`, { headers: { Authorization: adminAuth } })).json()) as { domains: { id: string; name: string }[] };
	const domainId = domains.domains.find((item) => item.name === hill)!.id;
	const made = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'],
			methodCalls: [['x:Account/set', { create: { a: { '@type': 'User', name: 'root', domainId, credentials: { '0': { '@type': 'Password', secret: password } }, roles: { '@type': 'Admin' } } } }, 's']]
		})
	});
	const madeReply = (await made.json()) as { methodResponses: [string, { created?: Record<string, { id: string }> }, string][] };
	const rootId = madeReply.methodResponses[0][1].created?.a?.id;
	expect(rootId).toBeTruthy();
	identity = { email: `root@${hill}`, email_verified: true };
	const page3 = await (await browser.newContext()).newPage();
	await toPasswordStep(page3, `root@${hill}`);
	await button(page3).click();
	await refused(page3);
	await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: [['x:Account/set', { destroy: [rootId] }, 'd']] })
	});

	// A private address is refused unless the operator allows it; here it is allowed,
	// so check the other side: switching it off takes the button away.
	expect((await fetch(`${base}${settings}`, { method: 'POST', headers: { ...json, Authorization: basic(hillBoss) }, body: JSON.stringify({ issuer, clientId: 'shippin', clientSecret: '', enabled: false }) })).status).toBe(200);
	expect((await (await fetch(`${base}/api/sso/${hill}`)).json()) as unknown).toEqual({ enabled: false });
	const page4 = await (await browser.newContext()).newPage();
	await toPasswordStep(page4, hillBoss);
	await expect(button(page4)).toHaveCount(0);
});
