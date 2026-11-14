import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Organisations in a real browser against the local stack: two on one server cannot
// see or touch each other, an administrator manages only theirs, and limits hold.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const password = `Org check ${run} pw`;
const hill = `hill-${run}.test`;
const vale = `vale-${run}.test`;
const hillBoss = `owner@${hill}`;
const valeBoss = `owner@${vale}`;
const hillName = `Hill Farm ${run}`;
const valeName = `Vale Shop ${run}`;

function basic(user: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function as(user: string, method: string, path: string, body?: unknown) {
	return fetch(`${base}${path}`, {
		method,
		headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function adminCall(method: string, path: string, body?: unknown) {
	return fetch(`${base}${path}`, {
		method,
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function signup(domain: string) {
	const res = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(res.status).toBe(200);
}

async function adminSignIn(page: Page) {
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
}

type Summary = { id: string; name: string; domains: string[] };
type Mine = { name: string; domains: { id: string; name: string }[]; people: { id: string; email: string }[] };

test.afterEach(async ({ browser }) => {
	await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
	const listed = (await (await adminCall('GET', '/api/orgs')).json()) as { orgs: Summary[] };
	for (const org of listed.orgs.filter((item) => item.name === hillName || item.name === valeName)) await adminCall('DELETE', `/api/orgs/${org.id}`);
	await as(hillBoss, 'POST', '/api/panel/domain/close', { confirm: hill });
	await as(valeBoss, 'POST', '/api/panel/domain/close', { confirm: vale });
});

test('two organisations on one server stay apart and their limits hold', async ({ browser }) => {
	test.setTimeout(240_000);
	await signup(hill);
	await signup(vale);

	// Only the server's administrators reach the list; nobody runs an organisation yet.
	expect((await fetch(`${base}/api/orgs`)).status).toBe(401);
	expect((await as(hillBoss, 'GET', '/api/orgs')).status).toBe(403);
	expect((await as(hillBoss, 'GET', '/api/org')).status).toBe(403);

	const adminContext = await browser.newContext();
	const page = await adminContext.newPage();
	await adminSignIn(page);
	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Organisations' }).click();
	await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible({ timeout: 30_000 });

	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// A form that is wrong says why.
	await page.getByRole('button', { name: 'New organisation' }).click();
	const form = page.getByRole('form', { name: 'New organisation' });
	await form.getByRole('button', { name: 'Save organisation' }).click();
	await expect(form.getByRole('alert')).toHaveText('Give the organisation a name.');

	await form.getByLabel('Name').fill(hillName);
	await form.getByRole('checkbox', { name: hill }).check();
	await form.getByLabel('Administrators').fill(hillBoss);
	await form.getByLabel('People allowed').fill('3');
	await form.getByLabel('Storage in GB').fill('3');
	await form.getByRole('button', { name: 'Save organisation' }).click();
	const listed = page.getByRole('list', { name: 'Organisations' }).getByRole('listitem').filter({ hasText: hillName });
	await expect(listed.getByText('1 of 3 people')).toBeVisible({ timeout: 30_000 });

	// The second through the API, and clashes are refused.
	const orgs = (await (await adminCall('GET', '/api/orgs')).json()) as { orgs: Summary[]; domains: { id: string; name: string }[] };
	const hillDomain = orgs.domains.find((domain) => domain.name === hill)!.id;
	const valeDomain = orgs.domains.find((domain) => domain.name === vale)!.id;
	const clash = await adminCall('POST', '/api/orgs', { name: 'Grabber', domains: [hillDomain, valeDomain], admins: [valeBoss], maxPeople: 5, maxStorageGb: 0 });
	expect(clash.status).toBe(400);
	expect(((await clash.json()) as { message: string }).message).toMatch(/another organisation/);
	const outsider = await adminCall('POST', '/api/orgs', { name: 'Outsider', domains: [valeDomain], admins: [hillBoss], maxPeople: 5, maxStorageGb: 0 });
	expect(outsider.status).toBe(400);
	expect((await adminCall('POST', '/api/orgs', { name: valeName, domains: [valeDomain], admins: [valeBoss], maxPeople: 5, maxStorageGb: 0 })).status).toBe(200);

	// The Hill administrator works in the browser, on their own organisation.
	const hillContext = await browser.newContext();
	const hillPage = await hillContext.newPage();
	await hillPage.goto(`/login?login_hint=${encodeURIComponent(hillBoss)}`);
	await hillPage.getByLabel('Account name').fill(hillBoss);
	await hillPage.getByRole('button', { name: 'Continue' }).click();
	await hillPage.getByLabel('Password').fill(password);
	await hillPage.getByRole('button', { name: 'Sign in' }).click();
	await hillPage.waitForURL(/\/shippin\/org$/, { timeout: 30_000 });
	await expect(hillPage.getByRole('heading', { name: hillName, level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(hillPage.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Organisation', exact: true })).toBeVisible();
	await expect(hillPage.getByText(vale)).toHaveCount(0);
	await hillPage.getByRole('navigation', { name: 'Organisation', exact: true }).getByRole('link', { name: 'People' }).click();
	await expect(hillPage.getByRole('heading', { name: 'People', level: 1 })).toBeVisible({ timeout: 30_000 });
	const lesson = hillPage.getByRole('complementary', { name: 'Run your organisation' });
	await expect(lesson.getByText('0 of 2 done')).toBeVisible();

	// Storage is shared, so a person needs a limit, and the total holds.
	await hillPage.getByRole('button', { name: 'Add a person' }).click();
	const add = hillPage.getByRole('form', { name: 'Add a person' });
	await add.getByLabel('Address').fill('ada');
	await add.getByLabel('Password').fill(`Ada secret ${run} word`);
	await add.getByRole('button', { name: 'Add person' }).click();
	await expect(add.getByRole('alert')).toContainText('set a limit');
	await add.getByLabel('Storage in GB').fill('5');
	await add.getByRole('button', { name: 'Add person' }).click();
	await expect(hillPage.getByText('more storage than your organisation has left')).toBeVisible({ timeout: 30_000 });
	await add.getByLabel('Storage in GB').fill('2');
	await add.getByRole('button', { name: 'Add person' }).click();
	const ada = hillPage.getByRole('list', { name: 'People' }).getByRole('listitem').filter({ hasText: `ada@${hill}` });
	await expect(ada.getByText('2 GB of storage')).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('1 of 2 done')).toBeVisible();

	// The new person really exists and can sign in.
	const adaAuth = 'Basic ' + Buffer.from(`ada@${hill}:Ada secret ${run} word`).toString('base64');
	await expect.poll(async () => (await fetch(`${base}/jmap/session`, { headers: { Authorization: adaAuth } })).status, { timeout: 30_000 }).toBe(200);

	// Editing, within what is left.
	await ada.getByRole('button', { name: `Edit ada@${hill}` }).click();
	const edit = hillPage.getByRole('form', { name: `Edit ada@${hill}` });
	await edit.getByLabel('Full name').fill('Ada Lovelace');
	await edit.getByLabel('Storage in GB').fill('1');
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(ada.getByText('Ada Lovelace. 1 GB of storage')).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('All done.')).toBeVisible();

	// Another address for Ada, added here and refused twice.
	await ada.getByRole('button', { name: `Edit ada@${hill}` }).click();
	const again = hillPage.getByRole('form', { name: `Edit ada@${hill}` });
	await again.getByLabel('New address').fill('countess');
	await again.getByRole('button', { name: 'Add address' }).click();
	await expect(again.getByText(`countess@${hill}`)).toBeVisible({ timeout: 30_000 });
	await again.getByLabel('New address').fill('countess');
	await again.getByRole('button', { name: 'Add address' }).click();
	await expect(hillPage.getByRole('alert')).toContainText('already exists', { timeout: 30_000 });
	await again.getByRole('button', { name: `Remove countess@${hill}` }).click();
	await expect(again.getByText(`countess@${hill}`)).toHaveCount(0, { timeout: 30_000 });
	await again.getByRole('button', { name: 'Close' }).click();

	// A team, with Ada on it.
	const panel = hillPage.getByRole('navigation', { name: 'Organisation', exact: true });
	await panel.getByRole('link', { name: 'Teams' }).click();
	await hillPage.getByLabel('Team address').fill('kitchen');
	const shape = hillPage.getByRole('complementary', { name: 'Shape your organisation' });
	await expect(shape.getByText('0 of 2 done')).toBeVisible({ timeout: 30_000 });
	await hillPage.getByRole('button', { name: 'Make team' }).click();
	const kitchen = hillPage.getByRole('list', { name: 'Teams' }).getByRole('listitem').filter({ hasText: `kitchen@${hill}` });
	await expect(kitchen).toBeVisible({ timeout: 30_000 });
	await expect(shape.getByText('1 of 2 done')).toBeVisible({ timeout: 30_000 });
	await kitchen.getByRole('checkbox', { name: `ada@${hill}` }).check();
	await expect(shape.getByText('All done.')).toBeVisible({ timeout: 30_000 });
	await expect.poll(async () => ((await (await as(hillBoss, 'GET', '/api/org')).json()) as Mine & { people: { email: string; teamIds: string[] }[] }).people.find((item) => item.email === `ada@${hill}`)?.teamIds.length, { timeout: 30_000 }).toBe(1);

	// Live DNS for its own domain, and only that.
	await panel.getByRole('link', { name: 'Domains' }).click();
	await expect(hillPage.getByRole('heading', { name: hill, level: 2 })).toBeVisible({ timeout: 30_000 });
	await expect(hillPage.getByText(/\d+ of \d+ DNS records are published/)).toBeVisible({ timeout: 60_000 });
	await expect(hillPage.getByRole('button', { name: `Choose a logo for ${hill}` }).or(hillPage.getByText(`Choose a logo for ${hill}`))).toBeVisible();
	const serious2 = (await new AxeBuilder({ page: hillPage }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(serious2.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
	await panel.getByRole('link', { name: 'People' }).click();
	await expect(hillPage.getByRole('heading', { name: 'People', level: 1 })).toBeVisible({ timeout: 30_000 });

	// Each sees only their own, and cannot reach across.
	const hillMine = (await (await as(hillBoss, 'GET', '/api/org')).json()) as Mine;
	const valeMine = (await (await as(valeBoss, 'GET', '/api/org')).json()) as Mine;
	expect(hillMine.people.map((person) => person.email).sort()).toEqual([`ada@${hill}`, hillBoss].sort());
	expect(valeMine.people.map((person) => person.email)).toEqual([valeBoss]);
	expect(valeMine.domains.map((domain) => domain.name)).toEqual([vale]);
	const adaId = hillMine.people.find((person) => person.email === `ada@${hill}`)!.id;
	expect((await as(valeBoss, 'POST', `/api/org/people/${adaId}`, { password: `Stolen ${run} password` })).status).toBe(404);
	expect((await as(valeBoss, 'DELETE', `/api/org/people/${adaId}`)).status).toBe(404);
	expect((await as(valeBoss, 'POST', '/api/org/people', { name: 'spy', domainId: hillDomain, password: `Spy secret ${run} word` })).status).toBe(403);
	await expect.poll(async () => (await fetch(`${base}/jmap/session`, { headers: { Authorization: adaAuth } })).status).toBe(200);

	const valeDns = await as(valeBoss, 'GET', `/api/org/domains/${hillDomain}/dns`);
	expect(valeDns.status).toBe(404);
	const teamId = ((await (await as(hillBoss, 'GET', '/api/org')).json()) as { teams: { id: string }[] }).teams[0].id;
	expect((await as(valeBoss, 'DELETE', `/api/org/teams/${teamId}`)).status).toBe(404);
	expect((await as(valeBoss, 'POST', `/api/org/teams/${teamId}/members`, { person: adaId, member: false })).status).toBe(404);
	expect((await as(valeBoss, 'POST', `/api/org/people/${adaId}/aliases`, { alias: 'stolen' })).status).toBe(404);

	// A server administrator with an address on the domain is out of the organisation's reach.
	const made = await adminCall('POST', '/jmap', {
		using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'],
		methodCalls: [['x:Account/set', { create: { a: { '@type': 'User', name: 'root', domainId: hillDomain, credentials: { '0': { '@type': 'Password', secret: password } }, roles: { '@type': 'Admin' } } } }, 's']]
	});
	const madeReply = (await made.json()) as { methodResponses: [string, { created?: Record<string, { id: string }> }, string][] };
	const rootId = madeReply.methodResponses[0][1].created?.a?.id;
	expect(rootId).toBeTruthy();
	expect((await as(hillBoss, 'POST', `/api/org/people/${rootId}`, { password: `Taken over ${run} word` })).status).toBe(404);
	expect((await as(hillBoss, 'DELETE', `/api/org/people/${rootId}`)).status).toBe(404);
	expect((await as(hillBoss, 'POST', `/api/org/people/${rootId}/aliases`, { alias: 'sneaky' })).status).toBe(404);
	expect((await fetch(`${base}/jmap/session`, { headers: { Authorization: basic(`root@${hill}`) } })).status).toBe(200);
	await adminCall('POST', '/jmap', { using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: [['x:Account/set', { destroy: [rootId] }, 'd']] });

	// An ordinary person runs nothing, and the people limit holds.
	expect((await fetch(`${base}/api/org`, { headers: { Authorization: adaAuth } })).status).toBe(403);
	expect((await as(hillBoss, 'POST', '/api/org/people', { name: 'bob', domainId: hillDomain, password: `Bob secret ${run} word`, limitGb: 1 })).status).toBe(200);
	const full = await as(hillBoss, 'POST', '/api/org/people', { name: 'cy', domainId: hillDomain, password: `Cy secret ${run} word`, limitGb: 1 });
	expect(full.status).toBe(403);
	expect(((await full.json()) as { message: string }).message).toMatch(/can have 3 people/);

	// The administrator cannot be removed; anyone else can.
	const bossId = hillMine.people.find((person) => person.email === hillBoss)!.id;
	expect((await as(hillBoss, 'DELETE', `/api/org/people/${bossId}`)).status).toBe(409);
	await hillPage.reload();
	const adaAgain = hillPage.getByRole('list', { name: 'People' }).getByRole('listitem').filter({ hasText: `ada@${hill}` });
	await adaAgain.getByRole('button', { name: `Remove ada@${hill}` }).click();
	await adaAgain.getByRole('button', { name: `Confirm remove ada@${hill}` }).click();
	await expect(adaAgain).toHaveCount(0, { timeout: 30_000 });
	await expect.poll(async () => (await fetch(`${base}/jmap/session`, { headers: { Authorization: adaAuth } })).status, { timeout: 30_000 }).toBe(401);

	await adminContext.close();
	await hillContext.close();
});
