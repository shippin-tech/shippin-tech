import { authorization } from '../../adapter/session';
import { logoUrl } from './brand-call';

export * from './brand-call';

async function call(method: string, domain: string, fallback: string, body?: Blob): Promise<void> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to change the logo.');
	const res = await fetch(logoUrl(domain), {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth },
		body
	});
	if (res.ok) return;
	const reply = (await res.json().catch(() => null)) as { message?: string; detail?: string } | null;
	throw new Error(reply?.message ?? reply?.detail ?? fallback);
}

export function uploadLogo(domain: string, file: Blob): Promise<void> {
	return call('POST', domain, 'The logo could not be saved.', file);
}

export function removeLogo(domain: string): Promise<void> {
	return call('DELETE', domain, 'The logo could not be removed.');
}
