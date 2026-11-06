import { authorization } from './session';
import { classifyMetrics } from './metrics-call';

export { reduceMetricsStream as reduceTraceStream } from './metrics-call';
export { classifyMetrics as classifyTracing } from './metrics-call';

export async function requestLiveTracing(): Promise<{ status: ReturnType<typeof classifyMetrics>; token: string }> {
	const auth = authorization();
	if (!auth) return { status: 'signed-out', token: '' };
	try {
		const res = await fetch('/api/token/tracing', {
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
