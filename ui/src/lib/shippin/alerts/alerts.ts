import { authorization } from '../../adapter/session';
import type { AlertCheck, AlertMetric, AlertPayload, AlertRule } from './alerts-call';

export * from './alerts-call';

async function call<T>(method: string, path: string, fallback: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to change alerts.');
	const res = await fetch(`/api/alerts${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (res.status === 403) throw new Error('Only administrators can change alerts.');
	const reply = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? fallback);
	return reply;
}

export function loadAlerts(): Promise<{ rules: AlertRule[]; metrics: AlertMetric[] }> {
	return call('GET', '', 'Alerts could not be loaded.');
}

export function saveAlert(rule: AlertPayload): Promise<AlertRule> {
	return call('POST', '', 'The alert could not be saved.', rule);
}

export function removeAlert(id: string): Promise<unknown> {
	return call('DELETE', `/${encodeURIComponent(id)}`, 'The alert could not be removed.');
}

export async function checkAlerts(): Promise<AlertCheck[]> {
	return (await call<{ results: AlertCheck[] }>('POST', '/check', 'The alerts could not be checked.')).results;
}
