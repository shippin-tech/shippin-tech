import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Docs in a real browser against the local stack: write with formatting, autosave,
// reopen, export, see it in Drive, a second writer, and a safe link.
const run = Math.random().toString(16).slice(2, 8);
const domain = `docs-${run}.test`;
const password = `Docs check ${run} pw`;
const owner = `owner@${domain}`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';

test.afterAll(async () => {
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64'), 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: domain })
	});
});

test('a person writes a document that saves itself, reopens, exports and lives in Drive', async ({ page, browser }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);

	await page.goto(`/login?login_hint=${encodeURIComponent(owner)}`);
	await page.getByLabel('Account name').fill(owner);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });

	await page.goto('/docs');
	await expect(page.getByText('No documents yet.', { exact: false })).toBeVisible({ timeout: 30_000 });
	const lesson = page.getByRole('complementary', { name: 'Write a document' });
	await expect(lesson.getByText('0 of 3 done')).toBeVisible();

	await page.getByRole('button', { name: 'New document' }).click();
	await page.getByLabel('Title').fill('bad/title');
	await page.getByRole('button', { name: 'Create document' }).click();
	await expect(page.getByRole('alert')).toContainText('cannot contain');
	await page.getByLabel('Title').fill('Quarterly plan');
	await page.getByRole('button', { name: 'Create document' }).click();
	await page.waitForURL(/\/docs\/edit/, { timeout: 30_000 });

	const text = page.getByRole('textbox', { name: 'Document text' });
	await expect(text).toBeVisible({ timeout: 30_000 });
	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// Write with formatting; it saves by itself.
	await text.click();
	await page.getByRole('button', { name: 'Heading 1' }).click();
	await page.keyboard.type('Goals');
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Bold' }).click();
	await page.keyboard.type('Grow');
	await page.getByRole('button', { name: 'Bold' }).click();
	await page.keyboard.type(' the business');
	await expect(text.locator('h1')).toHaveText('Goals');
	await expect(text.locator('strong')).toHaveText('Grow');
	await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 30_000 });

	// A link that is not safe is refused.
	await page.getByRole('button', { name: 'Link', exact: true }).click();
	await page.getByLabel('Link address').fill('javascript:alert(1)');
	await page.getByRole('button', { name: 'Apply link' }).click();
	await expect(page.getByRole('alert')).toContainText('web or email address');
	await page.getByRole('button', { name: 'Cancel' }).click();

	// Reopening shows what was written.
	await page.reload();
	await expect(text.locator('h1')).toHaveText('Goals', { timeout: 30_000 });
	await expect(text.locator('strong')).toHaveText('Grow');

	// Exports carry the content.
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download HTML' }).click()]);
	expect(download.suggestedFilename()).toBe('Quarterly plan.html');
	const chunks: Buffer[] = [];
	for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
	expect(Buffer.concat(chunks).toString()).toContain('<strong>Grow</strong>');
	const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
	expect(word.suggestedFilename()).toBe('Quarterly plan.doc');

	// Renaming from the editor reaches the list.
	await page.getByLabel('Document title').fill('Annual plan');
	await page.getByLabel('Document title').blur();
	await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 30_000 });
	await page.goto('/docs');
	await expect(page.getByRole('button', { name: 'Annual plan', exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('3 of 3 done')).toBeVisible();

	// It is a real file in Drive, and opening it there opens the editor.
	await page.goto('/files');
	await page.getByRole('button', { name: 'Documents', exact: true }).click({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Annual plan', exact: true }).click({ timeout: 30_000 });
	await page.waitForURL(/\/docs\/edit/, { timeout: 30_000 });
	await expect(text.locator('h1')).toHaveText('Goals', { timeout: 30_000 });

	// A second writer: the later save is stopped and the person chooses.
	const url = page.url();
	const other = await browser.newContext();
	const second = await other.newPage();
	await second.goto('/login?login_hint=' + encodeURIComponent(owner));
	await second.getByLabel('Account name').fill(owner);
	await second.getByRole('button', { name: 'Continue' }).click();
	await second.getByLabel('Password').fill(password);
	await second.getByRole('button', { name: 'Sign in' }).click();
	await second.waitForURL(/\/manage/, { timeout: 30_000 });
	await second.goto(url);
	const secondText = second.getByRole('textbox', { name: 'Document text' });
	await expect(secondText.locator('h1')).toHaveText('Goals', { timeout: 30_000 });
	await secondText.click();
	await second.keyboard.press('End');
	await second.keyboard.type(' from the second tab');
	await expect(second.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 30_000 });

	await text.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' from the first tab');
	await expect(page.getByRole('button', { name: 'Keep my version' })).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Keep my version' }).click();
	await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 30_000 });
	await other.close();

	// Delete asks first.
	await page.goto('/docs');
	await page.getByRole('button', { name: 'Delete Annual plan' }).click({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Delete for good' }).click();
	await expect(page.getByText('No documents yet.', { exact: false })).toBeVisible({ timeout: 30_000 });
});
