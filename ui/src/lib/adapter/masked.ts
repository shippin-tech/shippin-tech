import { authorization } from './session';
import { maskedLocal, type MaskedAddress } from './masked-call';

export * from './masked-call';

async function call<T>(method: string, path: string, fallback: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to change your masked addresses.');
	const res = await fetch(`/api/masked${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const reply = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? fallback);
	return reply;
}

export function loadMasked(): Promise<{ limit: number; addresses: MaskedAddress[] }> {
	return call('GET', '', 'Your masked addresses could not be loaded.');
}

export function createMasked(label: string): Promise<MaskedAddress> {
	return call('POST', '', 'A new address could not be made.', { label });
}

export function setMaskedEnabled(item: MaskedAddress, enabled: boolean): Promise<MaskedAddress> {
	return call('POST', `/${encodeURIComponent(maskedLocal(item.address))}`, 'The address could not be changed.', { enabled });
}

export function removeMasked(item: MaskedAddress): Promise<unknown> {
	return call('DELETE', `/${encodeURIComponent(maskedLocal(item.address))}`, 'The address could not be removed.');
}
