export type MetricsStatus = 'signed-out' | 'rejected' | 'failed' | 'ready' | 'disconnected';

export type MetricType = 'Counter' | 'Gauge' | 'Histogram';

export type MetricSample = {
	metric: string;
	type: MetricType;
	count: number;
	sum?: number;
};

export type StreamReason = 'token' | 'rejected' | 'retries';

export type StreamState =
	| { kind: 'idle' }
	| { kind: 'connecting'; attempt: number }
	| { kind: 'open'; attempt: number }
	| { kind: 'reconnecting'; attempt: number; delayMs: number }
	| { kind: 'closed' }
	| { kind: 'failed'; reason: StreamReason };

export type StreamEvent =
	| { type: 'connect' }
	| { type: 'opened' }
	| { type: 'stable' }
	| { type: 'retry' }
	| { type: 'stop' }
	| { type: 'error'; retryable: boolean; reason: StreamReason };

export const METRICS_RETRY = { maxAttempts: 5, baseDelayMs: 2000, maxDelayMs: 10000 };

export const CARD_METRICS = {
	'Total Users': 'user.count',
	'Total Domains': 'domain.count',
	'Pending Messages': 'queue.count'
} as const;

const TYPES = new Set<MetricType>(['Counter', 'Gauge', 'Histogram']);

export function classifyMetrics(status: number): MetricsStatus {
	if (status === 200) return 'ready';
	if (status === 401) return 'signed-out';
	if (status === 403 || status === 404) return 'rejected';
	return 'failed';
}

export function metricsFailure(reason: StreamReason): string {
	if (reason === 'token') return 'Failed to connect to live metrics.';
	if (reason === 'rejected') return 'The server refused the live metrics stream.';
	return 'Live metrics stream disconnected after multiple retries.';
}

export function metricsStreamUrl(token: string, names: readonly string[]): string {
	if (!token) return '';
	const params = new URLSearchParams();
	params.set('token', token);
	params.set('interval', '30');
	if (names.length) params.set('metrics', names.join(','));
	return `/api/live/metrics?${params.toString()}`;
}

export function metricsData(frame: string): string {
	const line = frame.split('\n').find((item) => item.startsWith('data: '));
	return line ? line.slice('data: '.length) : '';
}

export function parseMetricsPayload(body: string): MetricSample[] {
	const parsed = JSON.parse(body) as unknown;
	const list = Array.isArray(parsed) ? parsed : [parsed];
	if (!list.every(isSample)) throw new TypeError('Unexpected event stream payload');
	return list.map((item) => {
		const sample = item as { metric: string; '@type': MetricType; count: number; sum?: number };
		return sample['@type'] === 'Histogram'
			? { metric: sample.metric, type: sample['@type'], count: sample.count, sum: sample.sum }
			: { metric: sample.metric, type: sample['@type'], count: sample.count };
	});
}

export function cardCounts(samples: readonly MetricSample[]): Record<string, number> {
	const latest = new Map(samples.map((sample) => [sample.metric, sample.count]));
	const counts: Record<string, number> = {};
	for (const [title, metric] of Object.entries(CARD_METRICS)) {
		const count = latest.get(metric);
		if (count !== undefined) counts[title] = count;
	}
	return counts;
}

export function chartPoints(samples: readonly MetricSample[]): { step: number; count: number }[] {
	const metric = samples.find((sample) => sample.metric === 'user.count')?.metric ?? samples[0]?.metric;
	if (!metric) return [];
	const points: { step: number; count: number }[] = [];
	for (const sample of samples) {
		if (sample.metric !== metric) continue;
		points.push({ step: points.length + 1, count: sample.count });
	}
	return points;
}

export function reduceMetricsStream(
	state: StreamState,
	event: StreamEvent,
	limit = METRICS_RETRY
): StreamState {
	switch (event.type) {
		case 'connect':
			return { kind: 'connecting', attempt: 0 };
		case 'opened':
			return state.kind === 'connecting' ? { kind: 'open', attempt: state.attempt } : state;
		case 'stable':
			return state.kind === 'open' && state.attempt > 0 ? { kind: 'open', attempt: 0 } : state;
		case 'retry':
			return state.kind === 'reconnecting' ? { kind: 'connecting', attempt: state.attempt } : state;
		case 'stop':
			return state.kind === 'idle' || state.kind === 'closed' || state.kind === 'failed'
				? state
				: { kind: 'closed' };
		case 'error': {
			if (state.kind !== 'connecting' && state.kind !== 'open' && state.kind !== 'reconnecting') return state;
			const attempt = state.attempt + 1;
			if (event.retryable && attempt <= limit.maxAttempts) {
				const delayMs = Math.min(limit.maxDelayMs, limit.baseDelayMs * 2 ** Math.max(0, attempt - 1));
				return { kind: 'reconnecting', attempt, delayMs };
			}
			return { kind: 'failed', reason: event.reason };
		}
	}
}

function isSample(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const sample = value as { metric?: unknown; '@type'?: unknown; count?: unknown; sum?: unknown };
	if (typeof sample['@type'] !== 'string' || !TYPES.has(sample['@type'] as MetricType)) return false;
	if (typeof sample.metric !== 'string' || typeof sample.count !== 'number') return false;
	return sample['@type'] !== 'Histogram' || typeof sample.sum === 'number';
}
