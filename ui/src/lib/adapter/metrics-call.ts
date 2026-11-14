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

const TYPES = new Set<MetricType>(['Counter', 'Gauge', 'Histogram']);

export function classifyMetrics(status: number): MetricsStatus {
	if (status === 200) return 'ready';
	if (status === 401) return 'signed-out';
	if (status === 403 || status === 404) return 'rejected';
	return 'failed';
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
