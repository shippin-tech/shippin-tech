export const LIVE_TITLE = 'Live Tracing';
export const LIVE_SUBTITLE = 'Stream server events in real time.';
export const KEYWORDS_LABEL = 'Keywords (optional)';
export const KEYWORDS_PLACEHOLDER = 'Enter keywords to filter events...';
export const START_TRACING = 'Start tracing';
export const STOP_TRACING = 'Stop tracing';
export const CONNECTING = 'Connecting...';
export const STREAMING = 'Streaming events...';
export const FAILED_START = 'Failed to start live tracing.';
export const REFUSED = 'The server refused the live tracing stream.';
export const DISCONNECTED = 'Live tracing stream disconnected after multiple retries.';
export const NO_EVENTS = 'No trace events to display.';
export const BUFFER_FULL = '(buffer full)';
export const ADD_FILTER = 'Add filter';
export const FILTER_KEY = 'Filter key';
export const FILTER_VALUE = 'Filter value';
export const VALUE_PLACEHOLDER = 'Value...';
export const SPAN_TYPE = 'Span Type';
export const DATE_LABEL = 'Date';
export const DURATION_LABEL = 'Duration';
export const EVENTS_LABEL = 'Events';
export const BACK = 'Back';
export const LOADING = 'Loading...';
export const FAILED_LOAD = 'Failed to load trace';
export const NOT_FOUND = 'Trace not found';
export const UNRESOLVED = 'Could not resolve object';

export const TRACE_LIMIT = 1000;

export type TraceValue = { type: string; text: string };
export type TraceKeyValue = { key: string; value: TraceValue };
export type TraceEvent = { event: string; timestamp: string; keyValues: TraceKeyValue[] };
export type TraceFilter = { key: string; value: string };
export type TraceBuffer = { events: TraceEvent[]; dropped: number; anchor: string | null };
export type TraceLoad = 'ready' | 'loading' | 'missing' | 'failed' | 'unresolved';

const ERROR_WORDS = ['error', 'failed', 'invalid', 'reject'];

export function eventTone(name: string): 'error' | 'span' | 'info' {
	if (ERROR_WORDS.some((word) => name.includes(word))) return 'error';
	if (name.endsWith('-start') || name.endsWith('-end')) return 'span';
	return 'info';
}

export function durationMs(start: string, end: string): number | null {
	const ms = new Date(end).getTime() - new Date(start).getTime();
	return Number.isFinite(ms) ? ms : null;
}

export function durationLabel(events: readonly TraceEvent[]): string {
	if (events.length < 2) return '-';
	const ms = durationMs(events[0].timestamp, events[events.length - 1].timestamp);
	return ms == null ? '-' : `${ms} ms`;
}

export function traceSummary(events: readonly TraceEvent[]): {
	span: string;
	date: string;
	duration: string;
	count: number;
} {
	return {
		span: events[0]?.event || '-',
		date: events[0]?.timestamp || '-',
		duration: durationLabel(events),
		count: events.length
	};
}

export function tracingStreamUrl(
	token: string,
	keywords: string,
	filters: readonly TraceFilter[]
): string {
	if (!token) return '';
	const params = new URLSearchParams();
	params.set('token', token);
	const filter = keywords.trim();
	if (filter) params.set('filter', filter);
	for (const item of filters) {
		if (!item.key || item.key === 'filter' || item.key === 'token') continue;
		params.set(item.key, item.value);
	}
	return `/api/live/tracing?${params.toString()}`;
}

function valueOf(value: unknown): TraceValue {
	if (!value || typeof value !== 'object') return { type: 'Null', text: '' };
	const record = value as { '@type'?: unknown; value?: unknown; event?: unknown };
	const type = typeof record['@type'] === 'string' ? record['@type'] : 'Null';
	if (type === 'String' || type === 'IpAddr' || type === 'UTCDateTime') {
		return { type, text: typeof record.value === 'string' ? record.value : '' };
	}
	if (type === 'UnsignedInt' || type === 'Integer' || type === 'Float' || type === 'Boolean' || type === 'Duration') {
		return { type, text: record.value == null ? '' : String(record.value) };
	}
	if (type === 'Event') return { type, text: typeof record.event === 'string' ? record.event : '' };
	return { type, text: '' };
}

function isEvent(item: unknown): item is { event: string; timestamp: string; keyValues?: unknown } {
	if (!item || typeof item !== 'object') return false;
	const record = item as { event?: unknown; timestamp?: unknown };
	return typeof record.event === 'string' && typeof record.timestamp === 'string';
}

export function parseTracePayload(body: string): TraceEvent[] {
	const parsed = JSON.parse(body) as unknown;
	const list = Array.isArray(parsed) ? parsed : [parsed];
	if (!list.every(isEvent)) throw new TypeError('Unexpected trace event payload');
	return list.map((item) => ({
		event: item.event,
		timestamp: item.timestamp,
		keyValues: Array.isArray(item.keyValues)
			? item.keyValues
					.filter((entry) => entry && typeof entry === 'object')
					.map((entry) => {
						const pair = entry as { key?: unknown; value?: unknown };
						return { key: String(pair.key ?? ''), value: valueOf(pair.value) };
					})
			: []
	}));
}

export function appendTrace(buffer: TraceBuffer, incoming: readonly TraceEvent[]): TraceBuffer {
	if (!incoming.length) return buffer;
	const joined = buffer.events.concat(incoming);
	const droppedNow = Math.max(0, joined.length - TRACE_LIMIT);
	return {
		events: droppedNow > 0 ? joined.slice(droppedNow) : joined,
		dropped: buffer.dropped + droppedNow,
		anchor: buffer.anchor ?? incoming[0]?.timestamp ?? null
	};
}

export function eventCount(count: number): string {
	return `${count} events`;
}

export function removeFilterLabel(label: string): string {
	return `Remove filter ${label}`;
}
