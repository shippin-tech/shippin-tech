import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SCIM provisioning against the local stack, as an identity provider would use it:
// people and groups are created, changed and removed, and a token reaches only its domain.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const password = `Scim check ${run} pw`;
const adaFirst = `Ada first ${run} word`;
const adaSecond = `Ada second ${run} word`;
const hill = `hill-${run}.test`;
const vale = `vale-${run}.test`;
const hillBoss = `owner@${hill}`;
const valeBoss = `owner@${vale}`;
const ada = `ada@${hill}`;

function basic(user: string, secret = password) {
	return 'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64');
}

async function signup(domain: string) {
	const res = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(res.status).toBe(200);
}

function scim(token: string, method: string, path: string, body?: unknown) {
	return fetch(`${base}/api/scim/v2${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

const session = (user: string, secret: string) => fetch(`${base}/jmap/session`, { headers: { Authorization: basic(user, secret) } }).then((res) => res.status);
const patch = (...Operations: unknown[]) => ({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations });

test.afterAll(async () => {
	for (const [user, domain] of [[hillBoss, hill], [valeBoss, vale]]) {
		await fetch(`${base}/api/panel/domain/close`, {
			method: 'POST',
			headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: domain })
		});
	}
});

test('an identity provider manages one domain and reaches nothing else', async ({ page }) => {
	test.setTimeout(240_000);
	await signup(hill);
	await signup(vale);

	// A token is made in the browser and shown once.
	await page.goto(`/login?login_hint=${encodeURIComponent(hillBoss)}`);
	await page.getByLabel('Account name').fill(hillBoss);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });
	await expect(page.getByText('no SCIM token')).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: `Make a SCIM token for ${hill}` }).click();
	const shown = page.getByText(/^Token: /);
	await expect(shown).toBeVisible({ timeout: 30_000 });
	const token = ((await shown.locator('code').textContent()) ?? '').trim();
	expect(token).toMatch(/^scim\.\d+\./);
	await expect(page.getByRole('complementary', { name: 'About this key' })).toContainText('This token was made for you. Paste it into your identity provider.');
	await page.reload();
	await expect(page.getByText('can manage its people over SCIM')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(token)).toHaveCount(0);

	// Only the domain's manager can make one, and the secret never comes back.
	const settings = (user: string, method: string) => fetch(`${base}/api/scim/settings/${hill}`, { method, headers: { Authorization: basic(user) } });
	expect((await settings(valeBoss, 'POST')).status).toBe(403);
	const read = await (await settings(hillBoss, 'GET')).text();
	expect(read).not.toContain(token);
	expect(JSON.parse(read).hasToken).toBe(true);
	const valeToken = ((await (await fetch(`${base}/api/scim/settings/${vale}`, { method: 'POST', headers: { Authorization: basic(valeBoss) } })).json()) as { token: string }).token;

	// Without a good token there is nothing.
	expect((await fetch(`${base}/api/scim/v2/Users`)).status).toBe(401);
	expect((await scim('scim.1.wrong', 'GET', '/Users')).status).toBe(401);
	expect((await scim(`scim.1.${token.split('.')[2]}`, 'GET', '/Users')).status).toBe(401);

	const config = (await (await scim(token, 'GET', '/ServiceProviderConfig')).json()) as { patch: { supported: boolean } };
	expect(config.patch.supported).toBe(true);

	// Create.
	const created = await scim(token, 'POST', '/Users', {
		schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
		userName: ada,
		name: { formatted: 'Ada Lovelace' },
		externalId: `idp-${run}`,
		password: adaFirst,
		active: true
	});
	expect(created.status).toBe(201);
	expect(created.headers.get('content-type')).toContain('application/scim+json');
	const adaResource = (await created.json()) as { id: string; userName: string; active: boolean; displayName: string; externalId: string };
	expect(adaResource).toMatchObject({ userName: ada, active: true, displayName: 'Ada Lovelace', externalId: `idp-${run}` });
	await expect.poll(() => session(ada, adaFirst), { timeout: 30_000 }).toBe(200);
	expect((await scim(token, 'POST', '/Users', { userName: ada })).status).toBe(409);
	expect((await scim(token, 'POST', '/Users', { userName: `x@${vale}` })).status).toBe(403);

	// Read back by each filter providers use.
	type List = { totalResults: number; Resources: { id: string; members?: { value: string }[]; displayName?: string }[] };
	const byName = (await (await scim(token, 'GET', `/Users?filter=${encodeURIComponent(`userName eq "${ada}"`)}`)).json()) as List;
	expect(byName.totalResults).toBe(1);
	expect(byName.Resources[0].id).toBe(adaResource.id);
	const byExternal = (await (await scim(token, 'GET', `/Users?filter=${encodeURIComponent(`externalId eq "idp-${run}"`)}`)).json()) as List;
	expect(byExternal.totalResults).toBe(1);
	const none = (await (await scim(token, 'GET', `/Users?filter=${encodeURIComponent('userName eq "nobody@x.test"')}`)).json()) as List;
	expect(none.totalResults).toBe(0);

	// Update, both ways.
	const renamed = await scim(token, 'PATCH', `/Users/${adaResource.id}`, patch({ op: 'Replace', path: 'displayName', value: 'Ada King' }));
	expect(((await renamed.json()) as { displayName: string }).displayName).toBe('Ada King');
	const put = await scim(token, 'PUT', `/Users/${adaResource.id}`, { userName: ada, displayName: 'Countess Ada' });
	expect(((await put.json()) as { displayName: string }).displayName).toBe('Countess Ada');

	// Switching someone off the way Microsoft does it takes away their way in.
	const off = await scim(token, 'PATCH', `/Users/${adaResource.id}`, patch({ op: 'Replace', path: 'active', value: 'False' }));
	expect(((await off.json()) as { active: boolean }).active).toBe(false);
	await expect.poll(() => session(ada, adaFirst), { timeout: 30_000 }).toBe(401);

	// Back on with a new password.
	const on = await scim(token, 'PATCH', `/Users/${adaResource.id}`, patch({ op: 'replace', value: { active: true, password: adaSecond } }));
	expect(((await on.json()) as { active: boolean }).active).toBe(true);
	await expect.poll(() => session(ada, adaSecond), { timeout: 30_000 }).toBe(200);

	// Groups.
	const group = await scim(token, 'POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Sales Team', members: [{ value: adaResource.id }] });
	expect(group.status).toBe(201);
	const groupResource = (await group.json()) as { id: string; members: { value: string; display: string }[] };
	expect(groupResource.members).toEqual([{ value: adaResource.id, display: ada }]);
	const removed = (await (await scim(token, 'PATCH', `/Groups/${groupResource.id}`, patch({ op: 'Remove', path: `members[value eq "${adaResource.id}"]` }))).json()) as { members: unknown[] };
	expect(removed.members).toEqual([]);
	const added = (await (await scim(token, 'PATCH', `/Groups/${groupResource.id}`, patch({ op: 'Add', path: 'members', value: [{ value: adaResource.id }] }))).json()) as { members: unknown[] };
	expect(added.members).toHaveLength(1);
	const listed = (await (await scim(token, 'GET', `/Groups?filter=${encodeURIComponent('displayName eq "Sales Team"')}`)).json()) as List;
	expect(listed.totalResults).toBe(1);

	// Another domain's token reaches none of this.
	expect((await scim(valeToken, 'GET', `/Users/${adaResource.id}`)).status).toBe(404);
	expect((await scim(valeToken, 'PATCH', `/Users/${adaResource.id}`, patch({ op: 'Replace', path: 'password', value: `Stolen ${run} word` }))).status).toBe(404);
	expect((await scim(valeToken, 'DELETE', `/Users/${adaResource.id}`)).status).toBe(404);
	expect((await scim(valeToken, 'GET', `/Groups/${groupResource.id}`)).status).toBe(404);
	const theirs = (await (await scim(valeToken, 'GET', '/Users')).json()) as List;
	expect(theirs.Resources.map((item) => item.id)).not.toContain(adaResource.id);
	expect((await scim(valeToken, 'POST', '/Groups', { displayName: 'Spies', members: [{ value: adaResource.id }] })).status).toBe(400);

	// A server administrator on the domain is out of reach.
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
	const reply = (await made.json()) as { methodResponses: [string, { created?: Record<string, { id: string }> }, string][] };
	const rootId = reply.methodResponses[0][1].created?.a?.id;
	expect(rootId).toBeTruthy();
	expect((await scim(token, 'PATCH', `/Users/${rootId}`, patch({ op: 'Replace', path: 'password', value: `Taken over ${run} word` }))).status).toBe(403);
	expect((await scim(token, 'PATCH', `/Users/${rootId}`, patch({ op: 'Replace', path: 'active', value: false }))).status).toBe(403);
	expect((await scim(token, 'DELETE', `/Users/${rootId}`)).status).toBe(403);
	await expect.poll(() => session(`root@${hill}`, password), { timeout: 30_000 }).toBe(200);
	await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: [['x:Account/set', { destroy: [rootId] }, 'd']] })
	});

	// Remove.
	expect((await scim(token, 'DELETE', `/Groups/${groupResource.id}`)).status).toBe(204);
	expect((await scim(token, 'GET', `/Groups/${groupResource.id}`)).status).toBe(404);
	expect((await scim(token, 'DELETE', `/Users/${adaResource.id}`)).status).toBe(204);
	await expect.poll(() => session(ada, adaSecond), { timeout: 30_000 }).toBe(401);
	expect((await scim(token, 'GET', `/Users/${adaResource.id}`)).status).toBe(404);

	// A revoked token stops working at once.
	expect((await settings(hillBoss, 'DELETE')).status).toBe(200);
	expect((await scim(token, 'GET', '/Users')).status).toBe(401);
});
