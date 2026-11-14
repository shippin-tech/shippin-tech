/**
 * MCPL drive: the operator's screen carries out an agent's tool calls (see
 * crates/http/src/shippin/mcp.rs). Screens bind their declared actions with onAction;
 * the bar shows each call, takes the operator to its screen, asks before anything that
 * writes, then runs the same code the screen's own controls use.
 */
import { goto } from '$app/navigation';
import { authorization } from '../../adapter/session';
import { onRoute, parseCall, type AgentCall, type AgentOutcome } from './agent-call';

export type ActionResult = { text: string; data?: unknown };
type Args = Record<string, unknown>;
type Handler = { run: (args: Args) => Promise<ActionResult>; prepare?: (args: Args) => Promise<void> };

const handlers = new Map<string, Handler>();

/**
 * Binds a declared action (component.json "actions") to the code that does it. The name
 * must be a string literal: the conformance check reads it. `prepare` fills in and shows
 * the screen first, without changing anything, so the operator sees what they are asked
 * to allow. Returns the unbinding.
 */
export function onAction(name: string, run: Handler['run'], prepare?: Handler['prepare']): () => void {
	const handler = { run, prepare };
	handlers.set(name, handler);
	return () => {
		if (handlers.get(name) === handler) handlers.delete(name);
	};
}

export function boundActions(): string[] {
	return [...handlers.keys()].sort();
}

export const agent = $state<{
	connected: boolean;
	call: AgentCall | null;
	phase: 'idle' | 'moving' | 'asking' | 'working';
	last: string;
	lastOk: boolean;
}>({ connected: false, call: null, phase: 'idle', last: '', lastOk: true });

let decide: ((allowed: boolean) => void) | null = null;

/** The operator's answer to the question in the bar. */
export function answer(allowed: boolean): void {
	decide?.(allowed);
	decide = null;
}

/** Brings a part of the screen into view and marks it while the agent works there. */
export function spotlight(target: Element | string | null): void {
	const element = typeof target === 'string' ? document.querySelector(target) : target;
	if (!element) return;
	element.scrollIntoView({ behavior: 'smooth', block: 'center' });
	element.classList.add('agent-focus');
	setTimeout(() => element.classList.remove('agent-focus'), 4000);
}

/** A short pause, so the operator can see a field being filled before it is used. */
export const pause = (ms = 600) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Waits until the screen is ready, such as its data having loaded, before an action fills it
 * in: otherwise the screen's own loading overwrites what the agent filled.
 */
export async function until(ready: () => boolean, what: string, ms = 10_000): Promise<void> {
	const end = Date.now() + ms;
	while (!ready()) {
		if (Date.now() > end) throw new Error(`Nothing was done: ${what} did not finish loading.`);
		await pause(100);
	}
}

async function post(path: string, body: unknown): Promise<Response> {
	const auth = authorization();
	return fetch(path, {
		method: 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

async function waitForHandler(name: string, ms = 10_000): Promise<Handler | undefined> {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		const handler = handlers.get(name);
		if (handler) return handler;
		await pause(100);
	}
	return handlers.get(name);
}

async function run(call: AgentCall): Promise<AgentOutcome> {
	agent.call = call;
	agent.phase = 'moving';
	if (!onRoute(location.pathname, call.route) && call.name !== 'screen.read' && call.name !== 'screen.go') {
		await goto(call.route);
	}
	const handler = await waitForHandler(call.name);
	if (!handler) return { ok: false, text: `Nothing was done: the screen for ${call.title} did not open.` };
	try {
		await handler.prepare?.(call.arguments);
	} catch (err) {
		return { ok: false, text: err instanceof Error ? err.message : 'That cannot be done here.' };
	}
	if (call.writes) {
		agent.phase = 'asking';
		const allowed = await new Promise<boolean>((resolve) => {
			decide = resolve;
			setTimeout(() => resolve(false), Math.max(5, call.seconds - 5) * 1000);
		});
		if (agent.call?.callId !== call.callId) return { ok: false, text: 'Nothing was done: the call was cancelled.' };
		if (!allowed) return { ok: false, text: 'Nothing was done: the operator did not allow it.' };
	}
	agent.phase = 'working';
	try {
		const result = await handler.run(call.arguments);
		return { ok: true, text: result.text, data: result.data };
	} catch (err) {
		return { ok: false, text: err instanceof Error ? err.message : 'That did not work.' };
	}
}

let queue: Promise<void> = Promise.resolve();

function receive(call: AgentCall): void {
	// One call at a time, in the order the agent made them.
	queue = queue.then(async () => {
		const outcome = await run(call);
		agent.last = outcome.text;
		agent.lastOk = outcome.ok;
		agent.call = null;
		agent.phase = 'idle';
		await post('/api/mcp/viewport/result', { callId: call.callId, ...outcome }).catch(() => undefined);
	});
}

/** Opens this screen to agents for as long as it is open. Returns the closing. */
export function connectViewport(): () => void {
	let source: EventSource | null = null;
	let stopped = false;
	let retry: ReturnType<typeof setTimeout> | undefined;

	async function open() {
		if (stopped) return;
		try {
			const res = await post('/api/mcp/viewport/token', {});
			if (!res.ok) throw new Error(String(res.status));
			const { token } = (await res.json()) as { token: string };
			if (stopped) return;
			source = new EventSource(`/api/mcp/viewport/stream?token=${encodeURIComponent(token)}`);
			source.addEventListener('ready', () => (agent.connected = true));
			source.addEventListener('call', (event) => {
				const call = parseCall((event as MessageEvent<string>).data);
				if (call) receive(call);
			});
			source.addEventListener('cancel', (event) => {
				const { callId } = JSON.parse((event as MessageEvent<string>).data) as { callId: string };
				if (agent.call?.callId === callId) answer(false);
			});
			source.onerror = () => {
				agent.connected = false;
				source?.close();
				source = null;
				retry = setTimeout(open, 5000);
			};
		} catch {
			agent.connected = false;
			retry = setTimeout(open, 10_000);
		}
	}

	void open();
	return () => {
		stopped = true;
		clearTimeout(retry);
		source?.close();
		agent.connected = false;
	};
}
