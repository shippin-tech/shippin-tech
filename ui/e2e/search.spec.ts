import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('portal dashboard and search render from the catalog', async ({ page }) => {
	await page.goto('/portal');
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

test('delivery runner does not start a trace', async ({ page }) => {
	const live: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/live/delivery') || request.url().includes('/api/token/delivery')) {
			live.push(request.url());
		}
	});
	await page.goto('/portal/CustomComponent/LiveDelivery');
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
	await expect(page.getByText('Failed to start trace.')).toBeVisible();
	expect(live).toEqual([]);
});

test('live tracing does not open the stream', async ({ page }) => {
	const live: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/live/tracing') || request.url().includes('/api/token/tracing')) {
			live.push(request.url());
		}
	});
	await page.goto('/portal/CustomComponent/LiveTracing');
	await expect(page.getByRole('heading', { name: 'Live Tracing' })).toBeVisible();
	await expect(page.getByText('No trace events to display.')).toBeVisible();
	await page.getByRole('button', { name: 'Start tracing' }).click();
	await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
	expect(live).toEqual([]);
});

test('a signed-out action confirmation requests sign-in and does not post', async ({ page }) => {
	const posts: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST') posts.push(request.postData() ?? request.url());
	});
	await page.goto('/portal/x:Action');
	await expect(page.getByRole('heading', { name: 'Actions' })).toBeVisible();
	const reload = page.getByRole('button', { name: 'Reload: Server settings' });
	const dialog = page.getByRole('alertdialog');
	await expect(async () => {
		await reload.click();
		await expect(dialog.getByText('Run this action?')).toBeVisible({ timeout: 1000 });
	}).toPass();
	await dialog.getByRole('button', { name: 'Execute' }).click();
	await expect(page.getByText('Sign in to run actions.')).toBeVisible();
	await page.getByRole('button', { name: 'DMARC: Troubleshooting' }).click();
	await expect(page.getByText('This field is required.')).toBeVisible();
	expect(posts.filter((body) => body.includes('/set') || body.includes('x:Action'))).toEqual([]);
});

test('a signed-out list offers sign-in', async ({ page }) => {
	await page.goto('/portal/x:Domain');
	await expect(page.getByRole('heading', { name: 'Domains' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Sign in' }).last()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create Domain' })).toHaveCount(0);
});
