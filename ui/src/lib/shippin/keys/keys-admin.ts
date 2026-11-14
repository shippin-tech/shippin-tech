import { authorization } from '../../adapter/session';
import { newKeyBody, type KeysReport, type NewKeyDraft, type Replaced, type ServiceName } from './keys-admin-call';

export * from './keys-admin-call';

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch(`/api/keys${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined
	});
	const answer = (await res.json().catch(() => ({}))) as T & { detail?: string; message?: string };
	if (res.status === 403) throw new Error('Only the server’s administrators can see or change keys.');
	if (!res.ok) throw new Error(answer.message || answer.detail || 'The keys could not be changed.');
	return answer;
}

export function loadKeys(): Promise<KeysReport> {
	return call<KeysReport>('', 'GET');
}

export function authorKeys(): Promise<{ made: ServiceName[] }> {
	return call<{ made: ServiceName[] }>('/author', 'POST', {});
}

export function replaceKey(service: ServiceName, draft: NewKeyDraft): Promise<Replaced> {
	return call<Replaced>(`/${encodeURIComponent(service)}/replace`, 'POST', newKeyBody(draft));
}
