import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The portal requires a session (sign-in gate since 2026-11-08). These checks use a
// stored session and answer engine calls with empty results, so no backend is needed.
async function signedIn(page: Page) {
	await page.addInitScript(() => {
		sessionStorage.setItem('shippin-basic', 'token');
		sessionStorage.setItem('shippin-account', JSON.stringify({ username: 'admin@example.com', accountId: 'a' }));
	});
	await page.route('**/jmap', (route) => route.fulfill({ json: { methodResponses: [] } }));
	await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
}

test('portal dashboard and search render from the catalog', async ({ page }) => {
	await signedIn(page);
	await page.goto('/shippin/admin');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Welcome to ShippinTECH' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Last 24 hours' })).toBeVisible();

	const launch = page.getByRole('button', { name: /Search pages, fields, settings/ });
	const dialog = page.getByRole('dialog', { name: 'Search' });
	await expect(async () => {
		if (!(await dialog.isVisible())) await launch.click();
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass();
	await expect(dialog.getByText('Type to search the admin panel.')).toBeVisible();
	await dialog.getByRole('textbox').fill('domains');
	await expect(dialog.getByRole('link', { name: /Domains/ }).first()).toBeVisible();

	const results = await new AxeBuilder({ page }).include('dialog').analyze();
	expect(results.violations).toEqual([]);
});

test('delivery runner checks the target and opens no stream when the server refuses', async ({ page }) => {
	const streams: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/live/delivery')) streams.push(request.url());
	});
	await signedIn(page);
	await page.goto('/shippin/admin/CustomComponent/LiveDelivery');
	await expect(page.getByRole('heading', { name: 'Delivery Trace' })).toBeVisible();
	const target = page.getByLabel('Target address or domain');
	const start = page.getByRole('button', { name: 'Start trace' });
	await expect(async () => {
		await target.fill('not a domain');
		await start.click();
		await expect(page.getByText('Enter a valid email address or domain.')).toBeVisible({ timeout: 1000 });
	}).toPass();
	await target.fill('example.org');
	await start.click();
	await expect(page.getByText('The server refused the delivery trace: HTTP 404.')).toBeVisible();
	expect(streams).toEqual([]);
});

test('live tracing does not open the stream', async ({ page }) => {
	const live: string[] = [];
	page.on('request', (request) => {
		if (/\/api\/(live|token|trace)\/(tracing|live|token)/.test(request.url())) {
			live.push(request.url());
		}
	});
	await page.goto('/shippin/admin/CustomComponent/LiveTracing');
	await expect(page.getByRole('heading', { name: 'Live Tracing' })).toBeVisible();
	await expect(page.getByText('No trace events to display.')).toBeVisible();
	await page.getByRole('button', { name: 'Start tracing' }).click();
	await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
	expect(live).toEqual([]);
});

test('a signed-out visitor to actions is sent to sign in and nothing is posted', async ({ page }) => {
	const posts: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST') posts.push(request.postData() ?? request.url());
	});
	await page.goto('/shippin/admin/x:Action');
	await page.waitForURL(/\/login/);
	await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
	expect(posts.filter((body) => body.includes('/set') || body.includes('x:Action'))).toEqual([]);
});

test('a signed-out list offers sign-in', async ({ page }) => {
	await page.goto('/shippin/admin/x:Domain');
	await expect(page.getByRole('heading', { name: 'Domains' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Sign in' }).last()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create Domain' })).toHaveCount(0);
});
