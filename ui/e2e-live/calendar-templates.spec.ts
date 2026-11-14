import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Calendar emails in a real browser against the local stack: an administrator's own
// wording reaches a real guest's mailbox, and resetting goes back to the built-in one.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const domain = `invite-${run}.test`;
const password = `Invite check ${run} pw`;
const owner = `owner@${domain}`;
const guest = `guest@${domain}`;
const marker = `Sent with care by Hill Farm ${run}`;

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

async function jmap(user: string, using: string[], calls: unknown[]) {
	const res = await api('POST', '/jmap', user, { using: ['urn:ietf:params:jmap:core', ...using], methodCalls: calls });
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

async function primary(user: string, capability: string): Promise<string> {
	const session = (await (await api('GET', '/jmap/session', user)).json()) as { primaryAccounts: Record<string, string> };
	return session.primaryAccounts[capability];
}

const CALENDARS = 'urn:ietf:params:jmap:calendars';
const MAIL = 'urn:ietf:params:jmap:mail';

async function invite(title: string) {
	const accountId = await primary(owner, CALENDARS);
	const calendars = await jmap(owner, [CALENDARS], [['Calendar/get', { accountId }, 'c']]);
	const calendarId = (calendars[0][1].list as { id: string }[])[0].id;
	const set = await jmap(owner, [CALENDARS], [
		[
			'CalendarEvent/set',
			{
				accountId,
				sendSchedulingMessages: true,
				create: {
					e: {
						'@type': 'Event',
						title,
						calendarIds: { [calendarId]: true },
						start: '2030-06-15T10:00:00',
						duration: 'PT1H',
						timeZone: 'UTC',
						organizerCalendarAddress: `mailto:${owner}`,
						participants: {
							owner: { '@type': 'Participant', calendarAddress: `mailto:${owner}`, roles: { owner: true, attendee: true }, participationStatus: 'accepted' },
							guest0: { '@type': 'Participant', calendarAddress: `mailto:${guest}`, roles: { attendee: true }, participationStatus: 'needs-action', expectReply: true }
						}
					}
				}
			},
			's'
		]
	]);
	expect((set[0][1].created as Record<string, unknown> | undefined)?.e).toBeTruthy();
}

async function invitationHtml(title: string): Promise<string> {
	const accountId = await primary(guest, MAIL);
	const found = await jmap(guest, [MAIL], [
		['Email/query', { accountId, filter: { subject: title } }, 'q'],
		['Email/get', { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['htmlBody', 'bodyValues'], fetchHTMLBodyValues: true }, 'g']
	]);
	const list = (found[1][1].list as { htmlBody: { partId: string }[]; bodyValues: Record<string, { value: string }> }[] | undefined) ?? [];
	return list[0] ? (list[0].bodyValues[list[0].htmlBody[0].partId]?.value ?? '') : '';
}

test.afterAll(async () => {
	await fetch(`${base}/api/calendar-templates/invite`, { method: 'DELETE', headers: { Authorization: adminAuth } });
	await api('POST', '/api/panel/domain/close', owner, { confirm: domain });
});

test('an administrator rewords the invitation and a real guest receives it', async ({ page }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);
	expect((await api('POST', '/api/panel/mailboxes', owner, { name: 'guest', password })).status).toBe(200);

	expect((await fetch(`${base}/api/calendar-templates`)).status).toBe(401);
	expect((await api('GET', '/api/calendar-templates', owner)).status).toBe(403);

	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Calendar emails' }).click();
	await expect(page.getByRole('heading', { name: 'Calendar emails', level: 1 })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('Using the built-in email.')).toBeVisible({ timeout: 30_000 });

	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// A mistake is refused and explained.
	const box = page.getByLabel(/HTML of the/);
	const builtIn = await box.inputValue();
	expect(builtIn).toContain('{{');
	await box.fill('<p>{{no_such_placeholder}}</p>');
	await page.getByRole('button', { name: 'Save email' }).click();
	await expect(page.getByRole('alert')).toContainText('mistake', { timeout: 30_000 });

	// The new wording is saved and a real invitation carries it.
	await box.fill(builtIn.replace('</body>', `<p>${marker}</p></body>`));
	await page.getByRole('button', { name: 'Save email' }).click();
	await expect(page.getByText('Invitation email saved.')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('Using your email.')).toBeVisible();

	const custom = `Harvest supper ${run}`;
	await invite(custom);
	await expect.poll(() => invitationHtml(custom), { timeout: 60_000, intervals: [1_000] }).toContain(marker);

	// Back to the built-in email, and the next invitation does not carry it.
	await page.getByRole('button', { name: 'Go back to the built-in email' }).click();
	await expect(page.getByText('Using the built-in email.')).toBeVisible({ timeout: 30_000 });
	await expect(box).toHaveValue(builtIn);
	const plain = `Barn repair ${run}`;
	await invite(plain);
	await expect.poll(() => invitationHtml(plain), { timeout: 60_000, intervals: [1_000] }).not.toBe('');
	expect(await invitationHtml(plain)).not.toContain(marker);
});
