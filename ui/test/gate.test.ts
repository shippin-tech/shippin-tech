import { describe, expect, it } from 'vitest';
import { createGate, limitFor, RETRIES } from '../src/lib/adapter/gate';

const ORIGIN = 'http://mail.test';

function refused() {
	return new Response(
		JSON.stringify({ type: 'urn:ietf:params:jmap:error:limit', status: 400, limit: 'maxConcurrentRequests' }),
		{ status: 400, headers: { 'Content-Type': 'application/problem+json' } }
	);
}

// A server stand-in whose answers wait until the test lets them go.
function heldServer() {
	let active = 0;
	let most = 0;
	const held: Array<() => void> = [];
	const seen: string[] = [];
	const inner = ((input: RequestInfo | URL) => {
		seen.push(String(input));
		active += 1;
		most = Math.max(most, active);
		return new Promise<Response>((done) => {
			held.push(() => {
				active -= 1;
				done(new Response('{}', { status: 200 }));
			});
		});
	}) as typeof fetch;
	return { inner, held, seen, most: () => most };
}

const tick = () => new Promise((done) => setTimeout(done, 0));
const noPause = () => Promise.resolve();

describe('the request gate', () => {
	it('runs one fewer than the server allows, within bounds', () => {
		expect(limitFor(4)).toBe(3);
		expect(limitFor(1)).toBe(1);
		expect(limitFor(4294967295)).toBe(6);
		expect(limitFor(undefined)).toBe(3);
		expect(limitFor('4')).toBe(3);
	});

	it('never has more requests running than its limit, and runs them all', async () => {
		const server = heldServer();
		const gate = createGate(server.inner, ORIGIN, { limit: 3, pause: noPause });
		const all = Array.from({ length: 8 }, (_, n) => gate.fetch('/api/thing/' + n));
		while (server.seen.length < 8) {
			await tick();
			expect(server.held.length).toBeLessThanOrEqual(3);
			server.held.shift()?.();
		}
		while (server.held.length) server.held.shift()!();
		const answers = await Promise.all(all);
		expect(answers.map((res) => res.status)).toEqual(Array(8).fill(200));
		expect(server.most()).toBe(3);
	});

	it('sends a request again when the server refused it only for load', async () => {
		let calls = 0;
		const inner = (async () => (++calls === 1 ? refused() : new Response('ok'))) as typeof fetch;
		const gate = createGate(inner, ORIGIN, { pause: noPause });
		const res = await gate.fetch('/api/google', { method: 'POST', body: '{"a":1}' });
		expect(await res.text()).toBe('ok');
		expect(calls).toBe(2);
	});

	it('gives up after a few tries and hands back the refusal', async () => {
		let calls = 0;
		const inner = (async () => {
			calls += 1;
			return refused();
		}) as typeof fetch;
		const res = await createGate(inner, ORIGIN, { pause: noPause }).fetch('/jmap');
		expect(res.status).toBe(400);
		expect(calls).toBe(RETRIES + 1);
	});

	it('passes every other answer through untouched', async () => {
		const answers = [
			new Response('{"limit":"maxCallsInRequest"}', { status: 400, headers: { 'Content-Type': 'application/problem+json' } }),
			new Response('bad', { status: 400 }),
			new Response('', { status: 429 })
		];
		let calls = 0;
		const inner = (async () => answers[calls++]) as typeof fetch;
		const gate = createGate(inner, ORIGIN, { pause: noPause });
		expect((await gate.fetch('/api/a')).status).toBe(400);
		expect((await gate.fetch('/api/b')).status).toBe(400);
		expect((await gate.fetch('/api/c')).status).toBe(429);
		expect(calls).toBe(3);
	});

	it('leaves other sites and the app files out of the queue', async () => {
		const server = heldServer();
		const gate = createGate(server.inner, ORIGIN, { limit: 1, pause: noPause });
		void gate.fetch('/api/slow');
		void gate.fetch('/api/waits');
		void gate.fetch('https://hooks.example/alert');
		void gate.fetch(ORIGIN + '/_app/version.json');
		await tick();
		expect([...server.seen].sort()).toEqual(['/api/slow', ORIGIN + '/_app/version.json', 'https://hooks.example/alert']);
	});

	it('drops a waiting request that is cancelled', async () => {
		const server = heldServer();
		const gate = createGate(server.inner, ORIGIN, { limit: 1, pause: noPause });
		const first = gate.fetch('/api/first');
		const controller = new AbortController();
		const second = gate.fetch('/api/second', { signal: controller.signal });
		controller.abort(new Error('left the page'));
		await expect(second).rejects.toThrow('left the page');
		await tick();
		server.held.shift()!();
		expect((await first).status).toBe(200);
		expect(server.seen).toEqual(['/api/first']);
	});

	it('lets more through as soon as the limit is raised', async () => {
		const server = heldServer();
		const gate = createGate(server.inner, ORIGIN, { limit: 1, pause: noPause });
		void gate.fetch('/api/1');
		void gate.fetch('/api/2');
		await tick();
		expect(server.seen).toHaveLength(1);
		gate.setLimit(2);
		await tick();
		expect(server.seen).toHaveLength(2);
	});
});
