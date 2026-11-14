import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// The Google Drive link against the local stack, with a stand-in for Google on the
// host (deploy/local/compose.yaml points the server at it). The stand-in checks the
// real protocol: PKCE, the client secret, bearer tokens, multipart uploads.
const run = Math.random().toString(16).slice(2, 8);
const domain = `glink-${run}.test`;
const password = `Google check ${run} pw`;
const owner = `owner@${domain}`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const FAKE_PORT = 28099;

type FakeFile = { id: string; name: string; mimeType: string; parents: string[]; content?: string; shared?: boolean };

const FOLDER = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';

const files: FakeFile[] = [
	{ id: 'f-projects', name: 'Projects', mimeType: FOLDER, parents: ['root'] },
	{ id: 'f-notes', name: 'notes.txt', mimeType: 'text/plain', parents: ['root'], content: 'notes from google' },
	{ id: 'f-budget', name: 'Budget', mimeType: DOC, parents: ['root'], content: 'exported budget' },
	{ id: 'f-inner', name: 'inner.txt', mimeType: 'text/plain', parents: ['f-projects'], content: 'inner' },
	{ id: 'f-shared', name: 'From a friend.txt', mimeType: 'text/plain', parents: [], content: 'hi', shared: true }
];

const seen = { challenge: '', verified: false, revoked: [] as string[], uploads: [] as { name: string; body: string }[], badAuth: 0 };

function json(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

function describe(file: FakeFile) {
	return {
		id: file.id,
		name: file.name,
		mimeType: file.mimeType,
		parents: file.parents,
		size: file.content ? String(file.content.length) : undefined,
		modifiedTime: '2026-11-01T10:00:00.000Z',
		webViewLink: `https://drive.example/${file.id}`
	};
}

async function fakeGoogle(req: IncomingMessage, res: ServerResponse) {
	const url = new URL(req.url ?? '/', `http://localhost:${FAKE_PORT}`);
	if (url.pathname === '/o/oauth2/v2/auth') {
		seen.challenge = url.searchParams.get('code_challenge') ?? '';
		expect(url.searchParams.get('client_id')).toBe('local-client');
		const back = new URL(url.searchParams.get('redirect_uri')!);
		back.searchParams.set('code', 'the-code');
		back.searchParams.set('state', url.searchParams.get('state')!);
		res.writeHead(302, { Location: back.toString() });
		res.end();
		return;
	}
	if (url.pathname === '/token') {
		const form = new URLSearchParams((await bodyOf(req)).toString());
		if (form.get('client_secret') !== 'local-secret') return json(res, 401, { error: 'invalid_client' });
		if (form.get('grant_type') === 'authorization_code') {
			const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
			seen.verified = challenge === seen.challenge && form.get('code') === 'the-code';
			if (!seen.verified) return json(res, 400, { error: 'invalid_grant' });
		}
		return json(res, 200, { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 });
	}
	if (url.pathname === '/revoke') {
		seen.revoked.push(new URLSearchParams((await bodyOf(req)).toString()).get('token') ?? '');
		return json(res, 200, {});
	}
	if (req.headers.authorization !== 'Bearer access-token') {
		seen.badAuth += 1;
		return json(res, 401, { error: { code: 401 } });
	}
	if (url.pathname === '/drive/v3/about') return json(res, 200, { user: { emailAddress: 'someone@angrygaming.test' } });
	if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
		const body = (await bodyOf(req)).toString();
		const name = /"name":"([^"]+)"/.exec(body)?.[1] ?? '';
		seen.uploads.push({ name, body });
		return json(res, 200, describe({ id: `up-${seen.uploads.length}`, name, mimeType: 'text/plain', parents: ['root'] }));
	}
	if (url.pathname === '/drive/v3/files') {
		const q = url.searchParams.get('q') ?? '';
		const parent = /'([^']+)' in parents/.exec(q)?.[1];
		const name = /name contains '([^']+)'/.exec(q)?.[1]?.toLowerCase();
		const listed = files.filter((file) =>
			name ? file.name.toLowerCase().includes(name) : q.includes('sharedWithMe=true') ? file.shared : file.parents.includes(parent ?? '')
		);
		return json(res, 200, { files: listed.map(describe) });
	}
	const match = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(url.pathname);
	const file = files.find((item) => item.id === decodeURIComponent(match?.[1] ?? ''));
	if (!match || !file) return json(res, 404, { error: { code: 404 } });
	if (match[2] || url.searchParams.get('alt') === 'media') {
		res.writeHead(200, { 'Content-Type': match[2] ? (url.searchParams.get('mimeType') ?? '') : file.mimeType });
		res.end(file.content ?? '');
		return;
	}
	return json(res, 200, describe(file));
}

let server: Server;

test.beforeAll(async () => {
	server = createServer((req, res) => {
		fakeGoogle(req, res).catch((err) => {
			res.writeHead(500);
			res.end(String(err));
		});
	});
	await new Promise<void>((resolve) => server.listen(FAKE_PORT, '0.0.0.0', resolve));
});

test.afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64'), 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: domain })
	});
});

test('a person links Google Drive, copies both ways, exports a Google Doc and disconnects', async ({ page }) => {
	test.setTimeout(180_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);
	const auth = { Authorization: 'Basic ' + Buffer.from(`${owner}:${password}`).toString('base64') };
	expect((await fetch(`${base}/api/google`)).status).toBe(401);

	await page.goto(`/login?login_hint=${encodeURIComponent(owner)}`);
	await page.getByLabel('Account name').fill(owner);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/manage/, { timeout: 30_000 });

	// Connect: through the stand-in's sign-in and back, with PKCE checked.
	await page.goto('/files?view=google');
	const lesson = page.getByRole('complementary', { name: 'Link your Google Drive' });
	await page.getByRole('button', { name: 'Connect Google account' }).click({ timeout: 30_000 });
	await expect(page.getByText('Connected as')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('someone@angrygaming.test')).toBeVisible();
	expect(seen.verified).toBe(true);
	await expect(page).toHaveURL(/view=google$/);
	await expect(lesson.getByText('1 of 3 done')).toBeVisible();

	// The browser is told who is connected and nothing else.
	const status = await (await fetch(`${base}/api/google`, { headers: auth })).text();
	expect(status).not.toContain('token');
	expect(JSON.parse(status)).toEqual({ available: true, connected: true, email: 'someone@angrygaming.test' });

	// Browse, into a folder and back, and search.
	await expect(page.getByRole('button', { name: 'Projects' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('rowheader', { name: 'notes.txt' })).toBeVisible();
	await page.getByRole('button', { name: 'Projects' }).click();
	await expect(page.getByRole('rowheader', { name: 'inner.txt' })).toBeVisible({ timeout: 30_000 });
	await page.getByRole('navigation', { name: 'Google folder path' }).getByRole('button', { name: 'My files' }).click();
	await expect(page.getByRole('rowheader', { name: 'notes.txt' })).toBeVisible({ timeout: 30_000 });
	await page.getByLabel('Search Google Drive').fill('budget');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.getByRole('rowheader', { name: 'Budget' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('rowheader', { name: 'notes.txt' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Clear', exact: true }).click();
	await page.getByRole('button', { name: 'Shared with me', exact: true }).click();
	await expect(page.getByRole('rowheader', { name: 'From a friend.txt' })).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'My files', exact: true }).click();

	// Copy in: a plain file, and a Google Doc that exports to Word.
	await page.getByRole('button', { name: 'Copy notes.txt to my Drive' }).click({ timeout: 30_000 });
	await expect(page.getByText('notes.txt was copied to your Drive.')).toBeVisible({ timeout: 30_000 });
	await expect(lesson.getByText('2 of 3 done')).toBeVisible();
	await page.getByRole('button', { name: 'Copy Budget to my Drive' }).click();
	await expect(page.getByText('Budget was copied to your Drive.')).toBeVisible({ timeout: 30_000 });

	// They are real files in My Drive.
	await page.goto('/files');
	await page.getByRole('button', { name: 'From Google', exact: true }).click({ timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'notes.txt', exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'Budget.docx', exact: true })).toBeVisible();

	// Copy out.
	await page.getByRole('button', { name: 'Copy notes.txt to Google' }).click();
	await expect(page.getByText('notes.txt was copied to your Google Drive.')).toBeVisible({ timeout: 30_000 });
	expect(seen.uploads).toHaveLength(1);
	expect(seen.uploads[0].name).toBe('notes.txt');
	expect(seen.uploads[0].body).toContain('notes from google');

	// Disconnect: revoked at Google, and the tools go away.
	await page.goto('/files?view=google');
	await page.getByRole('button', { name: 'Disconnect' }).click({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Disconnect' }).click();
	await expect(page.getByRole('button', { name: 'Connect Google account' })).toBeVisible({ timeout: 30_000 });
	expect(seen.revoked).toEqual(['refresh-token']);
	expect((await fetch(`${base}/api/google/files`, { headers: auth })).status).toBe(409);
	expect(seen.badAuth).toBe(0);
});
