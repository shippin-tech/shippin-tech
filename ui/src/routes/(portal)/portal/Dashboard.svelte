<script lang="ts">
	import {
		cardCounts,
		chartPoints,
		metricsStreamUrl,
		parseMetricsPayload,
		reduceMetricsStream,
		requestLiveMetrics,
		type MetricSample,
		type MetricsStatus,
		type StreamState
	} from '$lib/adapter/metrics';
	import { publishSignals, publishStatusSignal } from '$lib/adapter/signal';
	import { metricSignals } from '$lib/portal/signal';
	import { account } from '$lib/adapter/session';
	import PortalView from '$lib/catalog/portal/PortalView.svelte';

	const names = ['user.count', 'domain.count', 'queue.count'] as const;

	let period = $state<'24h' | '7d' | '30d' | '90d'>('24h');
	let metrics = $state<'pending' | MetricsStatus>('pending');
	let samples = $state<MetricSample[]>([]);

	const counts = $derived(cardCounts(samples));
	const points = $derived(chartPoints(samples));

	$effect(() => {
		let cancelled = false;
		let source: EventSource | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let state: StreamState = { kind: 'idle' };
		samples = [];
		if (!account()) {
			metrics = 'signed-out';
			publishStatusSignal('metrics', 'metrics.session.signed-out', 'failed');
			return;
		}
		metrics = 'pending';
		publishStatusSignal('metrics', 'metrics.stream.connecting', 'pending');

		function stop() {
			source?.close();
			source = null;
			if (timer) clearTimeout(timer);
		}

		function listen(url: string) {
			stop();
			source = new EventSource(url);
			source.addEventListener('metrics', (event) => {
				if (cancelled) return;
				try {
					const next = parseMetricsPayload(String((event as MessageEvent).data));
					samples = [...samples, ...next];
					publishSignals(metricSignals(next));
					state = reduceMetricsStream(state, { type: 'opened' });
				} catch {
					fail(true, 'retries');
				}
			});
			source.onerror = () => {
				if (!cancelled) fail(true, 'retries');
			};
		}

		function fail(retryable: boolean, reason: 'token' | 'rejected' | 'retries') {
			source?.close();
			source = null;
			state = reduceMetricsStream(state, { type: 'error', retryable, reason });
			if (state.kind === 'failed') {
				metrics = reason === 'token' ? 'failed' : reason === 'rejected' ? 'rejected' : 'disconnected';
				publishStatusSignal(
					'metrics',
					reason === 'token' ? 'metrics.stream.token-failed' : reason === 'rejected' ? 'metrics.stream.rejected' : 'metrics.stream.disconnected',
					'failed'
				);
				return;
			}
			if (state.kind !== 'reconnecting') return;
			const wait = state.delayMs;
			timer = setTimeout(() => {
				if (cancelled) return;
				state = reduceMetricsStream(state, { type: 'retry' });
				const url = metricsStreamUrl(token, names);
				if (url) listen(url);
			}, wait);
		}

		let token = '';
		requestLiveMetrics().then((next) => {
			if (cancelled) return;
			metrics = next.status;
			token = next.token;
			const url = metricsStreamUrl(token, names);
			if (next.status !== 'ready' || !url) return;
			publishStatusSignal('metrics', 'metrics.stream.open', 'open');
			state = reduceMetricsStream(state, { type: 'connect' });
			listen(url);
		});

		return () => {
			cancelled = true;
			stop();
		};
	});
</script>

<PortalView view="CustomComponent/Dashboard" {period} {metrics} {counts} {points} onperiod={(next) => (period = next)} />
