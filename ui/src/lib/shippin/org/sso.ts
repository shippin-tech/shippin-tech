import { authorization } from '../../adapter/session';

export type SsoSettings = { issuer: string | null; clientId: string | null; hasSecret: boolean; enabled: boolean; callback: string };
export type SsoDraft = { issuer: string; clientId: string; clientSecret: string; enabled: boolean };

/** What the sign-in page already holds for the application asking to sign someone in. */
export type SsoRequest = {
	account: string;
	clientId: string;
	redirectUri: string;
	nonce: string | null;
	scope: string | null;
	codeChallenge: string | null;
	codeChallengeMethod: string | null;
	state: string | null;
};

export async function ssoOffered(domain: string): Promise<boolean> {
	try {
		const res = await fetch(`/api/sso/${encodeURIComponent(domain)}`, { cache: 'no-store' });
		return res.ok && ((await res.json()) as { enabled: boolean }).enabled;
	} catch {
		return false;
	}
}

export async function beginSso(request: SsoRequest): Promise<string> {
	const res = await fetch('/api/sso/begin', {
		method: 'POST',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(request)
	});
	const reply = (await res.json().catch(() => null)) as { url?: string; message?: string; detail?: string } | null;
	if (!res.ok || !reply?.url) throw new Error(reply?.message ?? reply?.detail ?? 'Your organisation sign-in could not be started.');
	return reply.url;
}

async function manage<T>(method: string, domain: string, fallback: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch(`/api/sso/${encodeURIComponent(domain)}/settings`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const reply = (await res.json().catch(() => null)) as (T & { message?: string; detail?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? reply?.detail ?? fallback);
	return reply;
}

export function loadSso(domain: string): Promise<SsoSettings> {
	return manage('GET', domain, 'The sign-in settings could not be loaded.');
}

export function saveSso(domain: string, draft: SsoDraft): Promise<unknown> {
	return manage('POST', domain, 'The sign-in settings could not be saved.', draft);
}

export function clearSso(domain: string): Promise<unknown> {
	return manage('DELETE', domain, 'The sign-in settings could not be removed.');
}
