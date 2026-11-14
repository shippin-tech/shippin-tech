<script lang="ts">
	import { TRACE_PAGE, listStoredTraces, loadStoredTrace, reduceTraceStream, requestLiveTracing, type StoredTrace } from '$lib/adapter/trace';
	import TraceHistory from '$lib/shippin/admin/TraceHistory.svelte';
	import { publishSignals, publishStatusSignal } from '$lib/adapter/signal';
	import { account } from '$lib/adapter/session';
	import LiveTracingPanel from '$lib/shippin/admin/LiveTracingPanel.svelte';
	import { traceSignals } from '$lib/portal/signal';
	import {
		appendTrace,
		parseTracePayload,
		tracingStreamUrl,
		type TraceBuffer,
		type TraceEvent,
		type TraceFilter
	} from '$lib/portal/trace';
	import type { StreamState } from '$lib/adapter/metrics';

	let phase = $state<'signed-out' | 'idle' | 'connecting' | 'rejected' | 'failed' | 'open' | 'disconnected'>('idle');
	let events = $state<TraceEvent[]>([]);
	let dropped = $state(0);
	let source: EventSource | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let token = '';
	let keywords = '';
	let filters: TraceFilter[] = [];
	let stream: StreamState = { kind: 'idle' };

	let tab = $state<'live' | 'history'>('live');
	let traces = $state<StoredTrace[]>([]);
	let historyNotice = $state('');
	let historyMore = $state(false);
	let opened = $state<{ trace: StoredTrace; events: TraceEvent[] } | null>(null);
	let filters_ = { query: '', kind: '', problems: false };

	async function loadHistory(before?: number) {
		historyNotice = before === undefined ? 'Loading.' : '';
		try {
			const next = await listStoredTraces({ ...filters_, before });
			traces = before === undefined ? next : [...traces, ...next];
			historyMore = next.length === TRACE_PAGE;
			historyNotice = '';
		} catch (err) {
			historyNotice = err instanceof Error ? err.message : 'Stored traces could not be loaded.';
		}
	}

	function showHistory() {
		tab = 'history';
		halt();
		if (phase === 'open' || phase === 'connecting') phase = 'idle';
		void loadHistory();
	}

	async function openTrace(trace: StoredTrace) {
		try {
			opened = { trace, events: parseTracePayload(await loadStoredTrace(trace.id)) };
		} catch (err) {
			historyNotice = err instanceof Error ? err.message : 'That trace could not be opened.';
		}
	}

	function halt() {
		source?.close();
		source = null;
		if (timer) clearTimeout(timer);
	}

	function listen(url: string) {
		halt();
		source = new EventSource(url);
		source.addEventListener('ready', () => {
			stream = reduceTraceStream(stream, { type: 'opened' });
			phase = 'open';
			publishStatusSignal('tracing', 'tracing.stream.open', 'open', { dropped });
		});
		source.addEventListener('trace', (event) => {
			try {
				const next = parseTracePayload(String((event as MessageEvent).data));
				publishSignals(traceSignals(next));
				const buffer: TraceBuffer = appendTrace({ events, dropped, anchor: events[0]?.timestamp ?? null }, next);
				events = buffer.events;
				dropped = buffer.dropped;
				stream = reduceTraceStream(stream, { type: 'opened' });
				phase = 'open';
				publishStatusSignal('tracing', 'tracing.stream.open', 'open', { dropped: buffer.dropped });
			} catch {
				fail(true, 'retries');
			}
		});
		source.onerror = () => fail(true, 'retries');
	}

	function fail(retryable: boolean, reason: 'token' | 'rejected' | 'retries') {
		source?.close();
		source = null;
		stream = reduceTraceStream(stream, { type: 'error', retryable, reason });
		if (stream.kind === 'failed') {
			phase = reason === 'rejected' ? 'rejected' : reason === 'token' ? 'failed' : 'disconnected';
			publishStatusSignal(
				'tracing',
				reason === 'rejected' ? 'tracing.stream.rejected' : reason === 'token' ? 'tracing.stream.token-failed' : 'tracing.stream.disconnected',
				'failed'
			);
			return;
		}
		if (stream.kind !== 'reconnecting') return;
		const wait = stream.delayMs;
		timer = setTimeout(() => {
			stream = reduceTraceStream(stream, { type: 'retry' });
			const url = tracingStreamUrl(token, keywords, filters);
			if (url) listen(url);
		}, wait);
	}

	function start(nextKeywords: string, nextFilters: TraceFilter[]) {
		halt();
		events = [];
		dropped = 0;
		keywords = nextKeywords;
		filters = nextFilters;
		stream = { kind: 'idle' };
		if (!account()) {
			phase = 'signed-out';
			publishStatusSignal('tracing', 'tracing.session.signed-out', 'failed');
			return;
		}
		phase = 'connecting';
		publishStatusSignal('tracing', 'tracing.stream.connecting', 'pending');
		requestLiveTracing().then((next) => {
			if (next.status !== 'ready') {
				phase = next.status === 'signed-out' ? 'signed-out' : next.status === 'rejected' ? 'rejected' : 'failed';
				publishStatusSignal(
					'tracing',
					next.status === 'signed-out' ? 'tracing.session.signed-out' : next.status === 'rejected' ? 'tracing.stream.rejected' : 'tracing.stream.token-failed',
					'failed'
				);
				return;
			}
			token = next.token;
			const url = tracingStreamUrl(token, keywords, filters);
			if (!url) {
				phase = 'failed';
				publishStatusSignal('tracing', 'tracing.stream.invalid-token', 'failed');
				return;
			}
			stream = reduceTraceStream(stream, { type: 'connect' });
			listen(url);
		});
	}

	function stop() {
		halt();
		token = '';
		phase = 'idle';
		publishStatusSignal('tracing', 'tracing.stream.stopped', 'cancelled');
	}
</script>

<div class="switch" role="group" aria-label="Tracing view">
	<button type="button" aria-pressed={tab === 'live'} onclick={() => (tab = 'live')}>Live</button>
	<button type="button" aria-pressed={tab === 'history'} onclick={showHistory}>History</button>
</div>
{#if tab === 'live'}
	<LiveTracingPanel {phase} {events} {dropped} onstart={start} onstop={stop} />
{:else}
	<TraceHistory
		{traces}
		notice={historyNotice}
		more={historyMore}
		{opened}
		onsearch={(query, kind, problems) => {
			filters_ = { query, kind, problems };
			void loadHistory();
		}}
		onmore={() => loadHistory(traces.at(-1)?.started)}
		onopen={openTrace}
		onclose={() => (opened = null)}
	/>
{/if}

<style>
	.switch { display: flex; gap: var(--x-2xs); margin-block-end: var(--y-2xs); }
	.switch button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	.switch button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
</style>
