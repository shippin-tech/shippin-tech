import { classifyMetrics, type MetricsStatus } from './metrics-call';
import { authorization } from './session';

export {
	cardCounts,
	chartPoints,
	classifyMetrics,
	metricsData,
	metricsFailure,
	metricsStreamUrl,
	parseMetricsPayload,
	reduceMetricsStream,
	type MetricSample,
	type MetricsStatus,
	type StreamEvent,
	type StreamState
} from './metrics-call';

export async function requestLiveMetrics(): Promise<{ status: MetricsStatus; token: string }> {
	const auth = authorization();
	if (!auth) return { status: 'signed-out', token: '' };
	try {
		const res = await fetch('/api/token/metrics', {
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
