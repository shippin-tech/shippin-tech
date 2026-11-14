import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// People and teams in a real browser against the local stack, as the administrator.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const username = `person${run}`;
const email = `${username}@local.test`;
const team = `team${run}`;
const firstPassword = `First secret ${run}`;
const secondPassword = `Second secret ${run}`;

function basic(user: string, password: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function adminJmap(calls: unknown[]) {
	const res = await fetch(`${base}/jmap`, {
		method: 'POST',
		headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: calls })
	});
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

test('an administrator adds people, makes a team, sets limits and removes them', async ({ page }) => {
	test.setTimeout(120_000);
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });

	await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'People and teams' }).click();
	await expect(page.getByRole('heading', { name: 'People and teams', level: 1 })).toBeVisible({ timeout: 30_000 });
	const serious = (await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	// A team first.
	await page.getByRole('button', { name: /^Teams/ }).click();
	await page.getByRole('button', { name: 'New team' }).click();
	await page.getByLabel('Team name').fill('not valid');
	await page.getByRole('button', { name: 'Create team' }).click();
	await expect(page.getByRole('alert')).toContainText('team name');
	await page.getByLabel('Team name').fill(team);
	await page.getByRole('region', { name: 'Details' }).getByLabel('Domain').selectOption({ label: 'local.test' });
	await page.getByRole('button', { name: 'Create team' }).click();
	await expect(page.getByRole('button', { name: team, exact: true })).toBeVisible({ timeout: 30_000 });

	// A person: a weak password is refused, then they can really sign in.
	await page.getByRole('button', { name: /^People/ }).click();
	await page.getByRole('button', { name: 'Add person' }).click();
	await page.getByLabel('Full name').fill('Test Person');
	await page.getByLabel('Username').fill(username);
	await page.getByRole('region', { name: 'Details' }).getByLabel('Domain').selectOption({ label: 'local.test' });
	await page.getByLabel('Password').fill('short');
	await page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Add person' }).click();
	await expect(page.getByRole('alert')).toContainText('10 characters');
	await page.getByLabel('Password').fill(firstPassword);
	await page.getByLabel('Storage limit in GB').fill('2');
	await page.getByRole('checkbox', { name: team }).check();
	await page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Add person' }).click();
	const row = page.getByRole('row', { name: new RegExp(email) });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(row).toContainText(team);
	await expect(row).toContainText('2 GB');
	expect((await fetch(`${base}/api/account`, { headers: { Authorization: basic(email, firstPassword) } })).status).toBe(200);

	// A duplicate is refused in words.
	await page.getByRole('button', { name: 'Add person' }).click();
	await page.getByLabel('Username').fill(username);
	await page.getByRole('region', { name: 'Details' }).getByLabel('Domain').selectOption({ label: 'local.test' });
	await page.getByLabel('Password').fill(firstPassword);
	await page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Add person' }).click();
	await expect(page.getByRole('alert')).toContainText('already', { timeout: 30_000 });
	await page.getByRole('button', { name: 'Cancel' }).click();

	// Edit: limit and password.
	await page.getByRole('button', { name: `Edit ${email}` }).click();
	await page.getByLabel('Storage limit in GB').fill('5');
	await page.getByLabel('New password').fill(secondPassword);
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(row).toContainText('5 GB', { timeout: 30_000 });
	await expect
		.poll(async () => (await fetch(`${base}/api/account`, { headers: { Authorization: basic(email, secondPassword) } })).status)
		.toBe(200);

	// Team membership from the team's side.
	await page.getByRole('button', { name: /^Teams/ }).click();
	await page.getByRole('button', { name: team, exact: true }).click();
	const members = page.getByRole('list', { name: 'Team members' });
	await expect(members).toContainText('Test Person');
	await page.getByRole('button', { name: `Take ${email} off the team` }).click();
	await expect(page.getByText('No one is in this team yet.')).toBeVisible({ timeout: 30_000 });
	await page.getByLabel('Add someone').selectOption({ label: 'Test Person' });
	await page.getByRole('button', { name: 'Add to team' }).click();
	await expect(members).toContainText('Test Person', { timeout: 30_000 });
	await page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Close' }).click();

	// You cannot remove yourself here.
	await page.getByRole('button', { name: /^People/ }).click();
	await expect(page.getByRole('button', { name: `Remove ${admin.username}@`, exact: false })).toHaveCount(0);

	// Remove the person, then the team.
	await page.getByRole('button', { name: `Remove ${email}` }).click();
	await expect(page.getByText('You can bring them back from Recover deleted', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Remove person', exact: true }).click();
	await expect(row).toHaveCount(0, { timeout: 30_000 });
	await page.getByRole('button', { name: /^Teams/ }).click();
	await page.getByRole('button', { name: `Remove team ${team}` }).click();
	await page.getByRole('button', { name: 'Remove team', exact: true }).click();
	await expect(page.getByRole('button', { name: team, exact: true })).toHaveCount(0, { timeout: 30_000 });

	const left = await adminJmap([['x:Account/query', { filter: { text: run } }, 'q']]);
	expect(left[0][1].ids).toEqual([]);
});
