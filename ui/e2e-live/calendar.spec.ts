import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The calendar in a real browser against the local stack: events, repeats, a second
// calendar, an invitation that reaches a real guest, and their reply coming back.
const run = Math.random().toString(16).slice(2, 8);
const domain = `cal-${run}.test`;
const password = `Calendar check ${run} pw`;
const owner = `owner@${domain}`;
const guest = `guest@${domain}`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';

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

async function signIn(page: Page, user: string) {
	await page.goto(`/login?login_hint=${encodeURIComponent(user)}`);
	await page.getByLabel('Account name').fill(user);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.afterAll(async () => {
	await api('POST', '/api/panel/domain/close', owner, { confirm: domain });
});

function isoDay(offset: number): string {
	const now = new Date();
	const day = new Date(now.getFullYear(), now.getMonth(), 15 + offset);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

test('events, repeats, calendars and an invitation answered by a real guest', async ({ browser }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);
	expect((await api('POST', '/api/panel/mailboxes', owner, { name: 'guest', password })).status).toBe(200);

	const ownerContext = await browser.newContext();
	const guestContext = await browser.newContext();
	const page = await ownerContext.newPage();
	const guestPage = await guestContext.newPage();
	await signIn(page, owner);
	await signIn(guestPage, guest);

	await page.goto('/calendar');
	await expect(page.getByRole('button', { name: 'New event', exact: true })).toBeVisible({ timeout: 30_000 });
	const lesson = page.getByRole('complementary', { name: 'Use your calendar' });
	await expect(lesson.getByText('0 of 3 done')).toBeVisible();
	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// A form that is wrong says why.
	await page.getByRole('button', { name: 'New event', exact: true }).click();
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(page.getByRole('alert')).toContainText('title');

	// Create.
	await page.getByLabel('Title').fill('Budget review');
	await page.getByLabel('Starts').fill(isoDay(0));
	await page.getByLabel('Ends').fill(isoDay(0));
	await page.getByLabel('At', { exact: true }).fill('10:00');
	await page.getByLabel('Until').fill('11:00');
	await page.getByLabel('Location').fill('Office');
	await page.getByRole('button', { name: 'Save event' }).click();
	const chip = page.getByRole('button', { name: /Budget review/ });
	await expect(chip).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('1 of 3 done')).toBeVisible();

	// Open and edit; the change sticks after a reload.
	await chip.click();
	await expect(page.getByRole('region', { name: 'Event' }).getByText('Office')).toBeVisible();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByLabel('Title').fill('Budget meeting');
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(page.getByRole('button', { name: /Budget meeting/ })).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('2 of 3 done')).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: /Budget meeting/ })).toBeVisible({ timeout: 30_000 });

	// A repeating all-day event appears on each occurrence.
	await page.getByRole('button', { name: 'New event', exact: true }).click();
	await page.getByLabel('Title').fill('Standup day');
	await page.getByLabel('All day').check();
	await page.getByLabel('Starts').fill(isoDay(-7));
	await page.getByLabel('Ends').fill(isoDay(-7));
	await page.getByLabel('Repeats').selectOption('weekly');
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect.poll(() => page.getByRole('button', { name: /Standup day/ }).count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);

	// A second calendar, shown and hidden.
	await page.getByRole('button', { name: 'New calendar' }).click();
	await page.getByLabel('Calendar name').fill('Work');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('checkbox', { name: 'Work' })).toBeVisible({ timeout: 30_000 });
	const defaultCalendar = page.getByRole('complementary', { name: 'Calendars' }).getByRole('checkbox').first();
	await defaultCalendar.uncheck();
	await expect(page.getByRole('button', { name: /Budget meeting/ })).toHaveCount(0);
	await defaultCalendar.check();
	await expect(page.getByRole('button', { name: /Budget meeting/ })).toBeVisible();

	// Invite a real guest.
	await page.getByRole('button', { name: /Budget meeting/ }).click();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByLabel('Guests').fill(guest);
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(lesson.getByText('3 of 3 done')).toBeVisible({ timeout: 30_000 });

	// It reaches the guest's calendar, and they answer.
	await expect(async () => {
		await guestPage.goto('/calendar');
		await expect(guestPage.getByRole('button', { name: /Budget meeting/ })).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 60_000 });
	await guestPage.getByRole('button', { name: /Budget meeting/ }).click();
	await expect(guestPage.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
	await guestPage.getByRole('button', { name: 'Going', exact: true }).click();

	// The organizer sees the answer.
	await expect(async () => {
		await page.reload();
		await page.getByRole('button', { name: /Budget meeting/ }).click({ timeout: 5_000 });
		await expect(page.getByRole('region', { name: 'Event' }).getByText('Going')).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 60_000 });

	// Agenda view, then delete with a warning.
	await page.getByRole('region', { name: 'Event' }).getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: 'Agenda' }).click();
	await page.getByRole('button', { name: /Budget meeting/ }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByText('Guests will be told.', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Delete event' }).click();
	await expect(page.getByRole('button', { name: /Budget meeting/ })).toHaveCount(0, { timeout: 30_000 });

	await ownerContext.close();
	await guestContext.close();
});
