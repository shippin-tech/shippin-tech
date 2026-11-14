import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Drive in a real browser against the local stack: everything a person does with
// their files, the lesson that teaches it, and the storage limit holding.
const run = Math.random().toString(16).slice(2, 8);
const domain = `drive-${run}.test`;
const owner = `owner@${domain}`;
const password = `Drive check ${run} pw`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');

async function adminJmap(calls: unknown[]) {
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: calls })
	});
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

async function domainId(): Promise<string | undefined> {
	const found = await adminJmap([
		['x:Domain/query', {}, 'q'],
		['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'g']
	]);
	return ((found[1][1].list as { id: string; name: string }[]) ?? []).find((item) => item.name === domain)?.id;
}

test.afterAll(async () => {
	const id = await domainId();
	if (!id) return;
	const accounts = await adminJmap([['x:Account/query', { filter: { domainId: id } }, 'q']]);
	const accountIds = (accounts[0][1].ids as string[]) ?? [];
	if (accountIds.length) await adminJmap([['x:Account/set', { destroy: accountIds }, 'a']]);
	const keys = await adminJmap([
		['x:DkimSignature/query', {}, 'q'],
		['x:DkimSignature/get', { '#ids': { resultOf: 'q', name: 'x:DkimSignature/query', path: '/ids' }, properties: ['id', 'domainId'] }, 'g']
	]);
	const doomed = ((keys[1][1].list as { id: string; domainId: string }[]) ?? []).filter((key) => key.domainId === id).map((key) => key.id);
	if (doomed.length) await adminJmap([['x:DkimSignature/set', { destroy: doomed }, 'k']]);
	await adminJmap([['x:Domain/set', { destroy: [id] }, 'd']]);
});

test('a person uses their Drive from upload to delete, and the storage limit holds', async ({ page }) => {
	test.setTimeout(180_000);

	await page.goto('/signup');
	await page.getByLabel('Domain').fill(domain);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText('_shippin-verify', { exact: true })).toBeVisible();
	await page.getByLabel('Your address').fill('owner');
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Repeat password').fill(password);
	await page.getByRole('button', { name: 'Verify and create' }).click();
	await expect(page.getByText(`${owner} is ready.`)).toBeVisible();

	await page.goto(`/login?login_hint=${encodeURIComponent(owner)}`);
	await page.getByLabel('Account name').fill(owner);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });

	await page.goto('/files');
	await expect(page.getByRole('heading', { name: 'Drive', level: 1 })).toBeVisible();
	await expect(page.getByText('Nothing here yet.', { exact: false })).toBeVisible({ timeout: 30_000 });
	const lesson = page.getByRole('complementary', { name: 'Use your Drive' });
	await expect(lesson.getByText('0 of 4 done')).toBeVisible();
	await expect(page.getByRole('meter', { name: 'Storage used' })).toBeVisible();

	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	const chooser = page.getByLabel('Choose files to upload');
	const content = `hello from ${run}`;
	const hello = { name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from(content) };

	// Upload; the lesson advances on the real event.
	await chooser.setInputFiles(hello);
	await expect(page.getByRole('button', { name: 'hello.txt', exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('1 of 4 done')).toBeVisible();

	// A taken name is never overwritten.
	await chooser.setInputFiles(hello);
	await expect(page.getByRole('button', { name: 'hello (2).txt', exact: true })).toBeVisible({ timeout: 30_000 });

	// Folders, including a name the server would refuse.
	await page.getByRole('button', { name: 'New folder' }).click();
	await page.getByLabel('Folder name').fill('bad/name');
	await page.getByRole('button', { name: 'Create folder' }).click();
	await expect(page.getByRole('alert')).toContainText('cannot contain');
	await page.getByLabel('Folder name').fill('Reports');
	await page.getByRole('button', { name: 'Create folder' }).click();
	await expect(page.getByRole('button', { name: 'Reports', exact: true })).toBeVisible();
	await expect(lesson.getByText('2 of 4 done')).toBeVisible();

	// Rename.
	await page.getByRole('button', { name: 'Rename hello (2).txt' }).click();
	await page.getByLabel('New name').fill('second.txt');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(page.getByRole('button', { name: 'second.txt', exact: true })).toBeVisible();

	// Move into the folder.
	await page.getByRole('button', { name: 'Move hello.txt' }).click();
	await page.getByLabel('Move to').selectOption({ label: 'Reports' });
	await page.getByRole('button', { name: 'Move here' }).click();
	await expect(page.getByRole('button', { name: 'hello.txt', exact: true })).toHaveCount(0);
	await expect(lesson.getByText('3 of 4 done')).toBeVisible();

	// Open the folder; the path and the address both follow.
	await page.getByRole('button', { name: 'Reports', exact: true }).click();
	await expect(page).toHaveURL(/folder=/);
	const path = page.getByRole('navigation', { name: 'Folder path' });
	await expect(path.getByText('Reports')).toBeVisible();
	await expect(page.getByRole('button', { name: 'hello.txt', exact: true })).toBeVisible();

	// Download returns the same bytes.
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download hello.txt' }).click()]);
	expect(download.suggestedFilename()).toBe('hello.txt');
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	expect(Buffer.concat(chunks).toString()).toBe(content);
	await expect(lesson.getByText('4 of 4 done')).toBeVisible();

	// A reload keeps the folder.
	await page.reload();
	await expect(page.getByRole('button', { name: 'hello.txt', exact: true })).toBeVisible({ timeout: 30_000 });
	await path.getByRole('button', { name: 'My Drive' }).click();
	await expect(page.getByRole('button', { name: 'second.txt', exact: true })).toBeVisible();

	// Search finds files inside folders too.
	await page.getByLabel('Search Drive').fill('hello');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.getByText('Results for "hello"')).toBeVisible();
	await expect(page.getByRole('button', { name: 'hello.txt', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'second.txt', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Clear', exact: true }).click();
	await expect(page.getByRole('button', { name: 'second.txt', exact: true })).toBeVisible();

	// Deleting a folder takes what is inside, after asking.
	await page.getByRole('button', { name: 'Delete Reports' }).click();
	await expect(page.getByText('Delete Reports and everything in it?')).toBeVisible();
	await page.getByRole('button', { name: 'Delete for good' }).click();
	await expect(page.getByRole('button', { name: 'Reports', exact: true })).toHaveCount(0);

	// The storage limit holds: shrink it, then try to go over.
	const id = await domainId();
	const accounts = await adminJmap([['x:Account/query', { filter: { domainId: id } }, 'q']]);
	const accountId = (accounts[0][1].ids as string[])[0];
	const updated = await adminJmap([['x:Account/set', { update: { [accountId]: { quotas: { maxDiskQuota: 4096 } } } }, 'u']]);
	expect(updated[0][1].updated).toBeTruthy();
	const big = { name: 'too-big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(64 * 1024, 7) };
	await expect(async () => {
		await chooser.setInputFiles(big);
		await expect(page.getByRole('region', { name: 'Uploads' }).getByText('You are out of storage.', { exact: false }).first()).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'too-big.bin', exact: true })).toHaveCount(0);
});
