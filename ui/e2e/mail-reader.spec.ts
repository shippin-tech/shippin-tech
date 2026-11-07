import { expect, test } from '@playwright/test';

test('opens a plain-text JMAP message without executing message content', async ({ page }) => {
	await page.addInitScript(() => {
		sessionStorage.setItem('shippin-basic', 'token');
		sessionStorage.setItem('shippin-account', JSON.stringify({ username: 'user', accountId: 'account' }));
	});
	await page.route('**/jmap', async (route) => {
		const request = route.request().postDataJSON();
		expect(request.methodCalls[0][1].fetchTextBodyValues).toBe(true);
		await route.fulfill({ json: { methodResponses: [['Email/get', { list: [{
			id: 'one', subject: 'Hello', from: [{ name: 'Sender' }],
			textBody: [{ partId: '1' }], bodyValues: { '1': { value: '<img src=x onerror=alert(1)>\nHello there' } }
		}] }, 'e0']] } });
	});
	await page.goto('/mail/email?id=one');
	await expect(page.getByRole('heading', { name: 'Hello' })).toBeVisible();
	await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: false })).toBeVisible();
	await expect(page.locator('.body img')).toHaveCount(0);
});
