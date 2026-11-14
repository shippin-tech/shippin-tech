import { expect, test } from '@playwright/test';

// First sign-in on a brand-new server: the printed setup key opens only the
// "Create your administrator" page, and stops working once that account exists.
// Needs a fresh node (see deploy/README.md, "Install on one host"):
//   FIRST_RUN_URL=http://127.0.0.1:48080 FIRST_RUN_KEY=<key> npx playwright test -c playwright.live.config.ts first-run
const url = process.env.FIRST_RUN_URL;
const key = process.env.FIRST_RUN_KEY;
test.skip(!url || !key, 'set FIRST_RUN_URL and FIRST_RUN_KEY to run against a fresh node');
test.use({ baseURL: url });

const admin = `boss@first-run-${Math.random().toString(16).slice(2, 8)}.test`;
const password = 'First run administrator pw';

test('the setup key leads to creating the administrator, then stops working', async ({ page }) => {
	const setup = await (await fetch(`${url}/api/setup`)).json();
	expect(setup.pending).toBe(true);

	await page.goto('/login');
	await page.getByLabel('Account name').fill('admin');
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(key!);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('heading', { name: 'Create your administrator' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);

	await page.getByLabel('Your administrator address').fill(admin);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Repeat password').fill(password);
	await page.getByRole('button', { name: 'Create administrator' }).click();
	await page.waitForURL(/\/login\?.*admin=1/, { timeout: 30_000 });
	await expect(page.getByText('Your administrator was created and the setup key no longer works.')).toBeVisible();

	expect((await (await fetch(`${url}/api/setup`)).json()).pending).toBe(false);
	const withKey = await fetch(`${url}/api/account`, { headers: { Authorization: 'Basic ' + Buffer.from(`admin:${key}`).toString('base64') } });
	expect(withKey.status).toBe(401);

	await page.getByLabel('Account name').fill(admin);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await expect(page.getByRole('heading', { name: 'Create your administrator' })).toHaveCount(0);
	await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Admin' })).toBeVisible();
});
