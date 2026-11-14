import { authorization } from './session';
import { classifyMetrics } from './metrics-call';

export { reduceMetricsStream as reduceTraceStream } from './metrics-call';
export { classifyMetrics as classifyTracing } from './metrics-call';

export async function requestLiveTracing(): Promise<{ status: ReturnType<typeof classifyMetrics>; token: string }> {
	const auth = authorization();
	if (!auth) return { status: 'signed-out', token: '' };
	try {
		const res = await fetch('/api/trace/token', {
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { Authorization: auth, Accept: 'text/plain' }
		});
		const status = classifyMetrics(res.status);
		const token = status === 'ready' ? (await res.text()).trim() : '';
		return { status, token };
	} catch {
		return { status: 'failed', token: '' };
	}
}

export type StoredTrace = {
	id: string;
	kind: string;
	started: number;
	ended: number;
	ip: string;
	from: string[];
	to: string[];
	problems: number;
	events: number;
};

export const TRACE_PAGE = 100;

/** A one-line description of a stored trace. */
export function traceHeadline(trace: Pick<StoredTrace, 'from' | 'to'>): string {
	const from = trace.from[0] ?? 'Unknown sender';
	const to = trace.to[0] ?? 'no recipient';
	const others = trace.to.length > 1 ? ` and ${trace.to.length - 1} more` : '';
	return `${from} to ${to}${others}`;
}

export function traceListUrl(options: { query?: string; kind?: string; problems?: boolean; before?: number }): string {
	const params = new URLSearchParams({ limit: String(TRACE_PAGE) });
	if (options.query?.trim()) params.set('q', options.query.trim());
	if (options.kind) params.set('kind', options.kind);
	if (options.problems) params.set('problems', '1');
	if (options.before !== undefined) params.set('before', String(options.before));
	return `/api/trace/history?${params.toString()}`;
}

export async function listStoredTraces(options: { query?: string; kind?: string; problems?: boolean; before?: number }): Promise<StoredTrace[]> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch(traceListUrl(options), { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: auth } });
	if (!res.ok) throw new Error(res.status === 403 ? 'Only administrators can see stored traces.' : 'Stored traces could not be loaded.');
	return ((await res.json()) as { traces: StoredTrace[] }).traces;
}

/** A stored trace's events, as the JSON text the trace parser reads. */
export async function loadStoredTrace(id: string): Promise<string> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch(`/api/trace/history/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: auth } });
	if (!res.ok) throw new Error('That trace is no longer kept.');
	return JSON.stringify(((await res.json()) as { events: unknown }).events);
}
