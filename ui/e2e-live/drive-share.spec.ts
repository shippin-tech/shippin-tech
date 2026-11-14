import { expect, test, type Page } from '@playwright/test';

// Sharing between two people on one domain, and the wall between domains, on the
// local stack. The rights are checked through the API as well as the screen.
const run = Math.random().toString(16).slice(2, 8);
const domainA = `share-a-${run}.test`;
const domainB = `share-b-${run}.test`;
const password = `Share check ${run} pw`;
const ownerA = `owner@${domainA}`;
const colleague = `sam@${domainA}`;
const ownerB = `owner@${domainB}`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const FILES = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:filenode', 'urn:ietf:params:jmap:principals'];

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

async function jmap(user: string, calls: unknown[]) {
	const res = await api('POST', '/jmap', user, { using: FILES, methodCalls: calls });
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

async function accountOf(user: string): Promise<string> {
	const session = (await (await api('GET', '/jmap/session', user)).json()) as { primaryAccounts: Record<string, string> };
	return session.primaryAccounts['urn:ietf:params:jmap:filenode'];
}

async function signup(domain: string) {
	const res = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(res.status).toBe(200);
}

async function signIn(page: Page, user: string) {
	await page.goto(`/login?login_hint=${encodeURIComponent(user)}`);
	await page.getByLabel('Account name').fill(user);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.afterAll(async () => {
	await api('POST', '/api/panel/domain/close', ownerA, { confirm: domainA });
	await api('POST', '/api/panel/domain/close', ownerB, { confirm: domainB });
});

test('sharing gives exactly the access chosen, follows folders, and stays inside the domain', async ({ browser }) => {
	test.setTimeout(180_000);
	await signup(domainA);
	await signup(domainB);
	expect((await api('POST', '/api/panel/mailboxes', ownerA, { name: 'sam', password })).status).toBe(200);
	const accountA = await accountOf(ownerA);
	const accountSam = await accountOf(colleague);
	const accountB = await accountOf(ownerB);

	// One customer of the server cannot see another's people.
	const seenByB = await jmap(ownerB, [['Principal/query', { accountId: accountB }, 'q']]);
	expect(seenByB[0][1].ids).toEqual([accountB]);
	const lookup = await jmap(ownerB, [['Principal/query', { accountId: accountB, filter: { email: ownerA } }, 'q']]);
	expect(lookup[0][1].ids).toEqual([]);
	const byId = await jmap(ownerB, [['Principal/get', { accountId: accountB, ids: [accountA] }, 'g']]);
	expect(byId[0][1].notFound).toEqual([accountA]);
	const seenByA = await jmap(ownerA, [['Principal/query', { accountId: accountA }, 'q']]);
	expect([...(seenByA[0][1].ids as string[])].sort()).toEqual([accountA, accountSam].sort());

	const ownerContext = await browser.newContext();
	const samContext = await browser.newContext();
	const owner = await ownerContext.newPage();
	const sam = await samContext.newPage();
	await signIn(owner, ownerA);
	await signIn(sam, colleague);

	// The owner makes a folder with something already in it, a folder inside that,
	// and a file in the inner folder.
	await owner.goto('/files');
	await owner.getByRole('button', { name: 'New folder' }).click();
	await owner.getByLabel('Folder name').fill('Team');
	await owner.getByRole('button', { name: 'Create folder' }).click();
	await owner.getByRole('button', { name: 'Team', exact: true }).click();
	await expect(owner).toHaveURL(/folder=/);
	await owner.getByLabel('Choose files to upload').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('the plan') });
	await expect(owner.getByRole('button', { name: 'plan.txt', exact: true })).toBeVisible({ timeout: 30_000 });
	await owner.getByRole('button', { name: 'New folder' }).click();
	await owner.getByLabel('Folder name').fill('Deep');
	await owner.getByRole('button', { name: 'Create folder' }).click();
	await owner.getByRole('button', { name: 'Deep', exact: true }).click();
	await expect(owner.getByText('This folder is empty.').or(owner.getByText('Nothing here yet.', { exact: false }))).toBeVisible();
	await owner.getByLabel('Choose files to upload').setInputFiles({ name: 'deep.txt', mimeType: 'text/plain', buffer: Buffer.from('deep bytes') });
	await expect(owner.getByRole('button', { name: 'deep.txt', exact: true })).toBeVisible({ timeout: 30_000 });

	// Before sharing, Sam has nothing.
	await sam.goto('/files?view=shared');
	await expect(sam.getByText('Nothing has been shared with you yet.')).toBeVisible({ timeout: 30_000 });

	// The owner shares the top folder as view-only; someone outside the domain cannot be found.
	await owner.goto('/files');
	await owner.getByRole('button', { name: 'Share Team' }).click();
	await expect(owner.getByText('Only you can see this.')).toBeVisible();
	await owner.getByLabel('Their address').fill(ownerB);
	await owner.getByRole('button', { name: 'Share', exact: true }).click();
	await expect(owner.getByRole('alert')).toContainText('No one with that address');
	await owner.getByLabel('Their address').fill(colleague);
	await owner.getByRole('button', { name: 'Share', exact: true }).click();
	await expect(owner.getByRole('list', { name: 'People with access' }).getByText(colleague, { exact: true })).toBeVisible();
	await owner.getByRole('button', { name: 'Done' }).click();
	await expect(owner.getByText('Shared', { exact: true })).toBeVisible();

	// Sam sees it, can open everything inside, and gets no buttons to change it.
	await sam.reload();
	await expect(sam.getByRole('button', { name: 'Team', exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(sam.getByRole('cell', { name: ownerA })).toBeVisible();
	await sam.getByRole('button', { name: 'Team', exact: true }).click();
	await expect(sam.getByRole('button', { name: 'plan.txt', exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(sam.getByRole('button', { name: 'Delete plan.txt' })).toHaveCount(0);
	await expect(sam.getByRole('button', { name: 'Rename plan.txt' })).toHaveCount(0);
	await expect(sam.getByRole('button', { name: 'Upload' })).toHaveCount(0);
	await sam.getByRole('button', { name: 'Deep', exact: true }).click();
	await expect(sam.getByRole('button', { name: 'deep.txt', exact: true })).toBeVisible({ timeout: 30_000 });
	const [download] = await Promise.all([sam.waitForEvent('download'), sam.getByRole('button', { name: 'Download deep.txt' }).click()]);
	expect(download.suggestedFilename()).toBe('deep.txt');

	// The server refuses a view-only person, whatever the screen shows.
	const listed = await jmap(colleague, [
		['FileNode/query', { accountId: accountA }, 'q'],
		['FileNode/get', { accountId: accountA, '#ids': { resultOf: 'q', name: 'FileNode/query', path: '/ids' }, properties: ['id', 'name'] }, 'g']
	]);
	const nodes = listed[1][1].list as { id: string; name: string }[];
	const id = (name: string) => nodes.find((node) => node.name === name)!.id;
	const refused = await jmap(colleague, [
		[
			'FileNode/set',
			{
				accountId: accountA,
				create: { x: { parentId: id('Team'), name: 'sneaky' } },
				update: { [id('plan.txt')]: { name: 'renamed.txt' } },
				destroy: [id('deep.txt')]
			},
			's'
		]
	]);
	expect(Object.keys((refused[0][1].notCreated as object) ?? {})).toEqual(['x']);
	expect(Object.keys((refused[0][1].notUpdated as object) ?? {})).toEqual([id('plan.txt')]);
	expect(Object.keys((refused[0][1].notDestroyed as object) ?? {})).toEqual([id('deep.txt')]);

	// Upgraded to edit, Sam can add to the folder.
	await owner.getByRole('button', { name: 'Share Team' }).click();
	await owner.getByLabel(`Access for ${colleague}`).selectOption('editor');
	await expect(owner.getByLabel(`Access for ${colleague}`)).toHaveValue('editor');
	await expect
		.poll(async () => {
			const rights = await jmap(colleague, [['FileNode/get', { accountId: accountA, ids: [id('deep.txt')], properties: ['myRights'] }, 'g']]);
			return (rights[0][1].list as { myRights: { mayRename: boolean } }[])[0].myRights.mayRename;
		})
		.toBe(true);
	await sam.goto(`/files?folder=${id('Team')}&drive=${accountA}`);
	await sam.getByLabel('Choose files to upload').setInputFiles({ name: 'from-sam.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
	await expect(sam.getByRole('button', { name: 'from-sam.txt', exact: true })).toBeVisible({ timeout: 30_000 });

	// Removing the share takes everything away, including what was added meanwhile.
	await owner.getByRole('button', { name: `Remove ${colleague}` }).click();
	await expect(owner.getByText('Only you can see this.')).toBeVisible();
	await expect
		.poll(async () => {
			const session = (await (await api('GET', '/jmap/session', colleague)).json()) as { accounts: Record<string, unknown> };
			return accountA in session.accounts;
		})
		.toBe(false);
	await sam.goto('/files?view=shared');
	await expect(sam.getByText('Nothing has been shared with you yet.')).toBeVisible({ timeout: 30_000 });

	await ownerContext.close();
	await samContext.close();
});
