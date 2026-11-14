import { classifyStats, parseStats, statsUrl, type Stats, type StatsRange, type StatsStatus } from './stats-call';
import { authorization } from '../../adapter/session';

export * from './stats-call';

/** Reads the dashboard data from our own `GET /api/stats`. */
export async function fetchStats(
	range: StatsRange,
	node: number | null = null
): Promise<{ status: StatsStatus; stats: Stats | null; message: string }> {
	const auth = authorization();
	if (!auth) return { status: 'signed-out', stats: null, message: '' };
	try {
		const res = await fetch(statsUrl(range, node), {
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { Authorization: auth, Accept: 'application/json' }
		});
		const status = classifyStats(res.status);
		if (status === 'invalid') {
			const body = (await res.json().catch(() => ({}))) as { message?: unknown };
			return { status, stats: null, message: typeof body.message === 'string' ? body.message : '' };
		}
		if (status !== 'ready') return { status, stats: null, message: '' };
		return { status, stats: parseStats(await res.json()), message: '' };
	} catch {
		return { status: 'failed', stats: null, message: '' };
	}
}
