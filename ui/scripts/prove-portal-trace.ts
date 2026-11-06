/**
 * Proves a trace frame becomes a timeline and the page does not open the stream.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-trace.ts
 */
import { readFileSync } from 'node:fs';
import {
	DISCONNECTED,
	FAILED_LOAD,
	FAILED_START,
	NO_EVENTS,
	NOT_FOUND,
	REFUSED,
	SPAN_TYPE,
	START_TRACING,
	UNRESOLVED,
	appendTrace,
	durationLabel,
	eventTone,
	parseTracePayload,
	tracingStreamUrl,
	traceSummary
} from '../src/lib/portal/trace.ts';

const body = JSON.stringify([
	{
		event: 'delivery.mx-lookup-start',
		timestamp: '2026-11-05T19:00:00Z',
		keyValues: [{ key: 'domain', value: { '@type': 'String', value: 'example.org' } }]
	},
	{ event: 'delivery.mx-lookup-end', timestamp: '2026-11-05T19:00:01Z', keyValues: [] }
]);
const events = parseTracePayload(body);
if (events.length !== 2 || events[0].keyValues[0]?.value.text !== 'example.org') throw new Error('parse');
if (eventTone(events[0].event) !== 'span') throw new Error('span');
if (eventTone('queue.failed') !== 'error') throw new Error('tone');
if (durationLabel(events) !== '1000 ms') throw new Error('duration');
const summary = traceSummary(events);
if (summary.span !== 'delivery.mx-lookup-start' || summary.count !== 2) throw new Error('summary');
if (NO_EVENTS !== 'No trace events to display.') throw new Error('empty copy');
if (SPAN_TYPE !== 'Span Type' || FAILED_LOAD !== 'Failed to load trace') throw new Error('detail copy');
if (NOT_FOUND !== 'Trace not found' || UNRESOLVED !== 'Could not resolve object') throw new Error('detail miss');
if (START_TRACING !== 'Start tracing' || FAILED_START !== 'Failed to start live tracing.') throw new Error('start copy');
if (REFUSED !== 'The server refused the live tracing stream.') throw new Error('refused');
if (DISCONNECTED !== 'Live tracing stream disconnected after multiple retries.') throw new Error('disconnected');

let threw = false;
try {
	parseTracePayload('{"interval":30000}');
} catch (err) {
	threw = err instanceof TypeError;
}
if (!threw) throw new Error('ping should not parse as a trace');

if (tracingStreamUrl('', 'mx', []) !== '') throw new Error('empty token');
const url = tracingStreamUrl('tok', 'example.org', [
	{ key: 'token', value: 'nope' },
	{ key: 'domain', value: 'example.org' }
]);
if (!url.startsWith('/api/live/tracing?') || !url.includes('token=tok') || !url.includes('filter=example.org')) {
	throw new Error('url ' + url);
}
if (url.includes('nope')) throw new Error('token filter leaked');

const filled = appendTrace(
	{ events: Array.from({ length: 1000 }, () => events[0]), dropped: 0, anchor: events[0].timestamp },
	[events[1]]
);
if (filled.events.length !== 1000 || filled.dropped !== 1) throw new Error('buffer');

const panel = readFileSync(new URL('../src/lib/catalog/portal/LiveTracingPanel.svelte', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../src/lib/catalog/portal/TraceDetail.svelte', import.meta.url), 'utf8');
const timeline = readFileSync(new URL('../src/lib/catalog/portal/TraceTimeline.svelte', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/routes/(portal)/portal/LiveTracing.svelte', import.meta.url), 'utf8');
for (const file of [panel, detail, timeline]) {
	if (file.includes("from '$lib/adapter") || file.includes('EventSource') || file.includes('/api/live/tracing')) {
		throw new Error('catalog fetches');
	}
}
if (!panel.includes('START_TRACING') || !timeline.includes('NO_EVENTS') || !detail.includes('SPAN_TYPE')) {
	throw new Error('bindings');
}
if (!page.includes('requestLiveTracing') || !page.includes("next.status !== 'ready'") || !page.includes('EventSource')) {
	throw new Error('route guard');
}
if (!page.includes('!account()')) throw new Error('signed-out guard');
if (page.includes('$effect')) throw new Error('route fetches on render');

console.log('ok');
