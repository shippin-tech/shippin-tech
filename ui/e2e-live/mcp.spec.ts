import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// MCPL drive in a real browser against the local stack. This file is the MCP client; the
// browser is the operator's screen. Every tool call is carried out on that screen, which
// asks before anything that writes, and nothing happens when no screen is open.
const run = Math.random().toString(16).slice(2, 8);
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
	username: string;
	secret: string;
};
const adminAuth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');
const MODERN = '2026-07-28';
let next = 1;

type Rpc = { status: number; body: { result?: Record<string, unknown> & { content?: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }; error?: { code: number; message: string; data?: unknown } } };

async function mcp(method: string, params: Record<string, unknown> = {}, options: { auth?: string; legacy?: string; headers?: Record<string, string> } = {}): Promise<Rpc> {
	const body = {
		jsonrpc: '2.0',
		id: next++,
		method,
		params: options.legacy ? params : { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientInfo': { name: 'live-test', version: run }, 'io.modelcontextprotocol/clientCapabilities': {} } }
	};
	const headers: Record<string, string> = {
		Authorization: options.auth ?? adminAuth,
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
		'MCP-Protocol-Version': options.legacy ?? MODERN,
		...(options.legacy ? {} : { 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}) }),
		...options.headers
	};
	const res = await fetch(`${base}/api/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
	const text = await res.text();
	if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
		const data = text.split('\n').filter((line) => line.startsWith('data: ')).at(-1) ?? '{}';
		return { status: res.status, body: JSON.parse(data.slice(6)) };
	}
	return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const call = (name: string, args: Record<string, unknown> = {}) => mcp('tools/call', { name, arguments: args });
const said = (rpc: Rpc) => rpc.body.result?.content?.[0]?.text ?? '';

async function signIn(page: Page) {
	await page.goto('/login');
	await page.getByLabel('Account name').fill(admin.username);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel('Password').fill(admin.secret);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/shippin\/admin/, { timeout: 30_000 });
}

test.afterEach(async ({ browser }) => {
	await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
	await fetch(`${base}/api/ai/settings`, { method: 'DELETE', headers: { Authorization: adminAuth } });
});

test('the protocol: both eras, checked headers, administrators only', async () => {
	const discover = await mcp('server/discover');
	expect(discover.status).toBe(200);
	expect(discover.body.result).toMatchObject({ resultType: 'complete', supportedVersions: [MODERN], capabilities: { tools: {} } });

	const listed = await mcp('tools/list');
	const names = (listed.body.result!.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[]).map((tool) => tool.name);
	expect(names).toEqual([...names].sort());
	expect(names).toEqual(expect.arrayContaining(['screen.read', 'screen.go', 'keys.list', 'keys.author', 'keys.replace', 'ai.settings.save', 'ai.connection.test']));

	// Clients still on the handshake-based versions.
	const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old', version: '1' } }, { legacy: '2025-06-18' });
	expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } } });
	expect((await mcp('tools/list', {}, { legacy: '2025-06-18' })).body.result!.tools).toHaveLength(names.length);

	expect((await mcp('tools/list', {}, { headers: { 'Mcp-Method': 'tools/call' } })).body.error?.code).toBe(-32020);
	const old = await mcp('tools/list', {}, { headers: { 'MCP-Protocol-Version': '1900-01-01' } });
	expect(old.status).toBe(400);
	expect(old.body.error?.code).toBe(-32020);
	expect((await mcp('nothing/here')).status).toBe(404);
	expect((await mcp('tools/call', { name: 'no.such.tool', arguments: {} })).body.error?.code).toBe(-32602);
	expect((await mcp('tools/list', {}, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
	expect((await fetch(`${base}/api/mcp`, { headers: { Authorization: adminAuth } })).status).toBe(405);
	expect((await fetch(`${base}/api/mcp`, { method: 'POST', body: '{}' })).status).toBe(401);

	const signup = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain: `mcp-${run}.test`, name: 'owner', password: `Mcp check ${run} pw` })
	});
	expect(signup.status).toBe(200);
	const owner = 'Basic ' + Buffer.from(`owner@mcp-${run}.test:Mcp check ${run} pw`).toString('base64');
	expect((await mcp('tools/list', {}, { auth: owner })).status).toBe(403);
	await fetch(`${base}/api/panel/domain/close`, {
		method: 'POST',
		headers: { Authorization: owner, 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: `mcp-${run}.test` })
	});
});

test('an agent works on the operatorâ€™s screen, and only with their say-so', async ({ page }) => {
	test.setTimeout(180_000);

	// With no screen open, nothing happens and the agent is told why.
	const nobody = await call('screen.read');
	expect(nobody.body.result?.isError).toBe(true);
	expect(said(nobody)).toMatch(/no admin panel is open/);

	await signIn(page);
	const bar = page.getByRole('complementary', { name: 'AI agent' });
	await expect(bar).toContainText('An AI agent can work on this screen', { timeout: 30_000 });
	const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

	const read = await call('screen.read');
	expect(read.body.result?.isError).toBe(false);
	expect(read.body.result?.structuredContent).toMatchObject({ route: '/shippin/admin' });

	// Keys are never passed by an agent.
	const paste = await call('keys.replace', { service: 'ai', from: 'value', value: 'AAAA' });
	expect(paste.body.result?.isError).toBe(true);
	expect(said(paste)).toMatch(/no argument called value|must be one of/);

	// A change the operator denies does not happen.
	const denied = call('keys.replace', { service: 'google', from: 'random' });
	await page.waitForURL(/\/shippin\/admin\/keys/, { timeout: 30_000 });
	await expect(bar).toContainText('An AI agent wants to: Replace a service key. This replaces or removes something. Allow it?', { timeout: 30_000 });
	await expect(bar).toContainText('google');
	await bar.getByRole('button', { name: 'Deny' }).click();
	const no = await denied;
	expect(no.body.result?.isError).toBe(true);
	expect(said(no)).toMatch(/did not allow/);

	// The same change, allowed: done by the Keys page itself, with its own result and event.
	const before = (await (await fetch(`${base}/api/keys`, { headers: { Authorization: adminAuth } })).json()) as { services: { service: string; keys: { id: number; state: string }[] }[] };
	const oldId = before.services.find((item) => item.service === 'google')!.keys.find((key) => key.state === 'primary')?.id ?? 0;
	const allowed = call('keys.replace', { service: 'google', from: 'random' });
	await expect(bar.getByRole('button', { name: 'Allow' })).toBeVisible({ timeout: 30_000 });
	await bar.getByRole('button', { name: 'Allow' }).click();
	const yes = await allowed;
	expect(yes.body.result?.isError).toBe(false);
	expect(said(yes)).toMatch(/^Google link: key \d+ is in use\./);
	await expect(page.getByRole('region', { name: 'Keys' }).getByText(said(yes))).toBeVisible();
	const after = (await (await fetch(`${base}/api/keys`, { headers: { Authorization: adminAuth } })).json()) as typeof before;
	expect(after.services.find((item) => item.service === 'google')!.keys.find((key) => key.state === 'primary')!.id).toBeGreaterThan(oldId);
	await expect(page.getByRole('complementary', { name: 'Author your keys' })).toBeVisible();

	// The AI settings: filled in on screen first, so the operator sees what they allow. No key.
	const save = call('ai.settings.save', { kind: 'openai', endpoint: 'http://host.docker.internal:28030/v1', model: `agent-model-${run}`, assistant: false });
	await page.waitForURL(/\/shippin\/admin\/ai/, { timeout: 30_000 });
	await expect(bar.getByRole('button', { name: 'Allow' })).toBeVisible({ timeout: 30_000 });
	const form = page.getByRole('form', { name: 'AI settings' });
	await expect(form.getByLabel('Model name')).toHaveValue(`agent-model-${run}`);
	await expect(form.getByLabel(/^Key/)).toHaveValue('');
	await bar.getByRole('button', { name: 'Allow' }).click();
	const saved = await save;
	expect(saved.body.result?.isError).toBe(false);
	const settings = (await (await fetch(`${base}/api/ai/settings`, { headers: { Authorization: adminAuth } })).json()) as { model: string; hasKey: boolean };
	expect(settings).toMatchObject({ model: `agent-model-${run}`, hasKey: false });
	await expect(bar).toContainText(`Last: Saved.`);

	// Going somewhere outside the admin panel is refused.
	const away = await call('screen.go', { route: '/mail' });
	expect(away.body.result?.isError).toBe(true);
	expect(page.url()).toContain('/shippin/admin');
});
