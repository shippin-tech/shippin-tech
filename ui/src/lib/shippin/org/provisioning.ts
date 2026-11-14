import { authorization } from '../../adapter/session';

export type ProvisioningStatus = { hasToken: boolean; endpoint: string };
export type ProvisioningToken = { token: string; endpoint: string };

async function call<T>(method: string, domain: string, fallback: string): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch(`/api/scim/settings/${encodeURIComponent(domain)}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth }
	});
	const reply = (await res.json().catch(() => null)) as (T & { message?: string; detail?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? reply?.detail ?? fallback);
	return reply;
}

export function loadProvisioning(domain: string): Promise<ProvisioningStatus> {
	return call('GET', domain, 'The provisioning settings could not be loaded.');
}

export function makeProvisioningToken(domain: string): Promise<ProvisioningToken> {
	return call('POST', domain, 'A token could not be made.');
}

export function revokeProvisioningToken(domain: string): Promise<unknown> {
	return call('DELETE', domain, 'The token could not be revoked.');
}
