import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// MCPL lesson progress kept on the server, against the local stack.
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const auth = { Authorization: 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64') };
const lesson = 'set-up-your-domain';

async function post(body: unknown, id = lesson) {
	return fetch(`${base}/api/learn/progress/${id}`, {
		method: 'POST',
		headers: { ...auth, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

test('lesson progress is kept per person, merged, and follows them to a new browser', async ({ page }) => {
	expect((await fetch(`${base}/api/learn/progress`)).status).toBe(401);
	expect((await fetch(`${base}/api/learn/progress/${lesson}`, { method: 'DELETE', headers: auth })).status).toBe(200);

	expect(await (await post({ done: ['publish-dns'], dismissed: false })).json()).toEqual({ done: ['publish-dns'], dismissed: false });
	// Another device that only knows a different step never takes the first one away.
	expect(await (await post({ done: ['add-mailbox'], dismissed: false })).json()).toEqual({
		done: ['publish-dns', 'add-mailbox'],
		dismissed: false
	});
	expect((await post({ done: ['Not Valid'] })).status).toBe(400);
	expect((await post({ done: [] }, 'Bad Id')).status).toBe(400);
	expect((await post('nonsense')).status).toBe(400);

	const all = (await (await fetch(`${base}/api/learn/progress`, { headers: auth })).json()) as {
		lessons: Record<string, { done: string[] }>;
	};
	expect(all.lessons[lesson].done).toEqual(['publish-dns', 'add-mailbox']);

	// A brand-new browser picks the progress up at sign-in.
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), `mcpl:lesson:${admin.username}:${lesson}`))
		.toContain('add-mailbox');

	// Starting over clears it.
	expect((await fetch(`${base}/api/learn/progress/${lesson}`, { method: 'DELETE', headers: auth })).status).toBe(200);
	const after = (await (await fetch(`${base}/api/learn/progress`, { headers: auth })).json()) as { lessons: Record<string, unknown> };
	expect(after.lessons[lesson]).toBeUndefined();
});
