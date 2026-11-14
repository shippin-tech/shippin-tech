import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The admin panel at its new home: our own menu, schema screens under All settings,
// and the old addresses still landing in the right place.
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};

test('the admin panel has its own menu and old addresses still work', async ({ page }) => {
	test.setTimeout(120_000);
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });

	const main = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(main.getByRole('link', { name: 'Admin', exact: true })).toBeVisible({ timeout: 30_000 });

	const menu = page.getByRole('navigation', { name: 'Admin' });
	for (const group of ['Overview', 'People', 'Mail', 'Security', 'AI', 'All settings']) {
		await expect(menu.getByRole('heading', { name: group, exact: true })).toBeVisible();
	}
	const serious = (await new AxeBuilder({ page }).include('nav[aria-label="Admin"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// Every link in our own menu opens a page in the panel, marked as current.
	for (const [label, href] of [
		['Resources', '/shippin/admin/resources'],
		['Organisations', '/shippin/admin/orgs'],
		['People and teams', '/shippin/admin/people'],
		['Delivery check', '/shippin/admin/delivery'],
		['Tracing', '/shippin/admin/tracing'],
		['Alerts', '/shippin/admin/alerts'],
		['Recover deleted', '/shippin/admin/recover'],
		['Calendar emails', '/shippin/admin/templates'],
		['Security baseline', '/shippin/admin/security'],
		['AI settings', '/shippin/admin/ai'],
		['Dashboard', '/shippin/admin']
	] as const) {
		const link = menu.getByRole('link', { name: label, exact: true });
		await link.click();
		await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 30_000 });
		await expect(link).toHaveAttribute('aria-current', 'page');
	}

	// The schema's screens are still reachable, without repeating ours.
	await menu.getByText('Management', { exact: true }).click();
	await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(1);
	const domains = menu.getByRole('link', { name: 'Domains', exact: true });
	await domains.first().click();
	await expect(page).toHaveURL(/\/shippin\/admin\/x:Domain/, { timeout: 30_000 });

	// Old addresses land in the right place, keeping what follows.
	await page.goto('/portal');
	await page.waitForURL(/\/shippin\/admin$/, { timeout: 30_000 });
	await page.goto('/portal/people');
	await page.waitForURL(/\/shippin\/admin\/people$/, { timeout: 30_000 });
	await expect(page.getByRole('heading', { name: 'People and teams', level: 1 })).toBeVisible({ timeout: 30_000 });
	await page.goto('/portal/x:Domain?q=abc');
	await page.waitForURL(/\/shippin\/admin\/x:Domain\?q=abc$/, { timeout: 30_000 });
});
