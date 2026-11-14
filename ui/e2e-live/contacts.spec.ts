import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Contacts in a real browser against the local stack.
const run = Math.random().toString(16).slice(2, 8);
const domain = `people-${run}.test`;
const password = `Contacts check ${run} pw`;
const owner = `owner@${domain}`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';

test.afterAll(async () => {
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64'), 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: domain })
	});
});

test('a person keeps their contacts: add, find, change, write to, remove', async ({ page }) => {
	test.setTimeout(120_000);
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

	await page.goto('/contacts');
	await expect(page.getByText('No contacts yet.', { exact: false })).toBeVisible({ timeout: 30_000 });
	const lesson = page.getByRole('complementary', { name: 'Keep your contacts' });
	await expect(lesson.getByText('0 of 2 done')).toBeVisible();
	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// An empty form says what it needs; a bad address is refused.
	await page.getByRole('button', { name: 'New contact' }).click();
	await page.getByRole('button', { name: 'Save contact' }).click();
	await expect(page.getByRole('alert')).toContainText('Add a name');
	await page.getByLabel('First name').fill('Ada');
	await page.getByLabel('Last name').fill('Lovelace');
	await page.getByLabel('Email 1').fill('ada@example.org');
	await page.getByRole('button', { name: 'Add another email' }).click();
	await page.getByLabel('Email 2').fill('countess@example.org');
	await page.getByLabel('Phone 1').fill('+1 555 0100');
	await page.getByLabel('Company').fill('Analytical Engines');
	await page.getByLabel('Job title').fill('Programmer');
	await page.getByLabel('Notes').fill('First programmer');
	await page.getByRole('button', { name: 'Save contact' }).click();
	const row = page.getByRole('list', { name: 'Contacts' }).getByRole('button', { name: /Ada Lovelace/ });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('1 of 2 done')).toBeVisible();

	// A second person, and search.
	await page.getByRole('button', { name: 'New contact' }).click();
	await page.getByLabel('First name').fill('Grace');
	await page.getByLabel('Last name').fill('Hopper');
	await page.getByRole('button', { name: 'Save contact' }).click();
	await expect(page.getByRole('button', { name: /Grace Hopper/ })).toBeVisible({ timeout: 30_000 });
	await page.getByLabel('Search contacts').fill('analytical');
	await expect(row).toBeVisible();
	await expect(page.getByRole('button', { name: /Grace Hopper/ })).toHaveCount(0);
	await page.getByLabel('Search contacts').fill('');

	// Details, and the change survives a reload.
	await row.click();
	const panel = page.getByRole('region', { name: 'Contact' });
	await expect(panel.getByText('Programmer, Analytical Engines')).toBeVisible();
	await expect(panel.getByRole('link', { name: 'Write to countess@example.org' })).toBeVisible();
	await panel.getByRole('button', { name: 'Edit' }).click();
	await page.getByLabel('Company').fill('Babbage and Co');
	await page.getByRole('button', { name: 'Save contact' }).click();
	await expect(lesson.getByText('2 of 2 done')).toBeVisible({ timeout: 30_000 });
	await page.reload();
	await page.getByRole('button', { name: /Ada Lovelace/ }).click({ timeout: 30_000 });
	await expect(panel.getByText('Programmer, Babbage and Co')).toBeVisible();

	// Writing to them opens webmail with the address filled in.
	await panel.getByRole('link', { name: 'Write to ada@example.org' }).click();
	await expect(page.getByLabel('To', { exact: true })).toHaveValue('ada@example.org', { timeout: 30_000 });
	await page.goBack();

	// An address book of their own, then remove what was made.
	await page.getByRole('button', { name: 'New address book' }).click({ timeout: 30_000 });
	await page.getByLabel('Address book name').fill('Clients');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Clients', exact: true })).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Delete address book Clients' }).click();
	await expect(page.getByRole('button', { name: 'Clients', exact: true })).toHaveCount(0, { timeout: 30_000 });

	await page.getByRole('button', { name: /Grace Hopper/ }).click();
	await panel.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('button', { name: 'Delete contact' }).click();
	await expect(page.getByRole('button', { name: /Grace Hopper/ })).toHaveCount(0, { timeout: 30_000 });
});
