// The server lets each person run only a few requests at once (JMAP's
// maxConcurrentRequests, 4 unless an administrator changes it) and refuses the rest
// before doing any work. A page here starts several requests together, so every
// request to this server waits its turn, and one refused for that reason alone is
// sent again.

type Fetch = typeof fetch;

export const LIMIT_KEY = 'shippin.requestLimit';
const DEFAULT_LIMIT = 3;
const MOST = 6;
export const RETRIES = 5;

function clamp(limit: number): number {
	return Math.min(MOST, Math.max(1, Math.floor(limit)));
}

/** How many to run at once for what the server advertises: one fewer, so another tab or a live stream still fits. */
export function limitFor(advertised: unknown): number {
	if (typeof advertised !== 'number' || !Number.isFinite(advertised)) return DEFAULT_LIMIT;
	return clamp(advertised - 1);
}

export type Gate = { fetch: Fetch; setLimit(limit: number): void };

type Options = { limit?: number; pause?: (ms: number) => Promise<void> };

export function createGate(inner: Fetch, origin: string, options: Options = {}): Gate {
	let limit = clamp(options.limit ?? DEFAULT_LIMIT);
	const pause = options.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
	let active = 0;
	const queue: Array<() => void> = [];

	function next() {
		while (active < limit && queue.length) {
			active += 1;
			queue.shift()!();
		}
	}

	function enter(signal: AbortSignal | null | undefined): Promise<void> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		return new Promise((resolve, reject) => {
			const stop = () => {
				const at = queue.indexOf(go);
				if (at >= 0) queue.splice(at, 1);
				reject(signal?.reason);
			};
			const go = () => {
				signal?.removeEventListener('abort', stop);
				resolve();
			};
			signal?.addEventListener('abort', stop, { once: true });
			queue.push(go);
			next();
		});
	}

	function leave() {
		active -= 1;
		next();
	}

	function ours(input: RequestInfo | URL): boolean {
		const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
		try {
			const url = new URL(raw, origin);
			return url.origin === origin && !url.pathname.startsWith('/_app/');
		} catch {
			return false;
		}
	}

	async function refusedForLoad(res: Response): Promise<boolean> {
		if (res.status !== 400 || !(res.headers.get('content-type') ?? '').includes('problem+json')) return false;
		try {
			return ((await res.clone().json()) as { limit?: unknown }).limit === 'maxConcurrentRequests';
		} catch {
			return false;
		}
	}

	function resendable(init: RequestInit | undefined): boolean {
		return !(typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream);
	}

	const gated: Fetch = async (input, init) => {
		if (!ours(input)) return inner(input, init);
		const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
		for (let attempt = 0; ; attempt += 1) {
			await enter(signal);
			const res = await inner(input instanceof Request ? input.clone() : input, init).finally(leave);
			if (attempt >= RETRIES || !resendable(init) || !(await refusedForLoad(res))) return res;
			await pause(150 * 2 ** attempt + Math.random() * 100);
		}
	};

	return {
		fetch: gated,
		setLimit(value: number) {
			limit = clamp(value);
			next();
		}
	};
}

let installed: Gate | null = null;

/** Puts every request to this server through one gate. Runs once, as the app starts. */
export function installRequestGate(scope: typeof globalThis = globalThis): void {
	if (installed || typeof scope.fetch !== 'function' || !scope.location) return;
	let saved: number | undefined;
	try {
		saved = Number(scope.sessionStorage?.getItem(LIMIT_KEY)) || undefined;
	} catch {
		saved = undefined;
	}
	installed = createGate(scope.fetch.bind(scope), scope.location.origin, { limit: saved });
	scope.fetch = installed.fetch;
}

/** Follows the limit a session document advertises, and remembers it for this tab. */
export function followServerLimit(capabilities: unknown): void {
	const core = (capabilities as Record<string, { maxConcurrentRequests?: unknown } | undefined> | undefined)?.[
		'urn:ietf:params:jmap:core'
	];
	const limit = limitFor(core?.maxConcurrentRequests);
	installed?.setLimit(limit);
	try {
		sessionStorage.setItem(LIMIT_KEY, String(limit));
	} catch {
		// No storage: the default stands after a reload.
	}
}
