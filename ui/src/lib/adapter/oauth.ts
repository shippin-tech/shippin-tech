import { STORAGE_PREFIX } from './discover-call';
import { exchangeFailed } from './oauth-call';
import { openBearer } from './session';

export async function exchangeAuthorizationCode(): Promise<void> {
	const params = new URLSearchParams(window.location.search);
	const code = params.get('code');
	const state = params.get('state');
	const saved = sessionStorage.getItem(`${STORAGE_PREFIX}state`);
	const verifier = sessionStorage.getItem(`${STORAGE_PREFIX}code_verifier`);
	const clientId = sessionStorage.getItem(`${STORAGE_PREFIX}client_id`);
	const tokenEndpoint = sessionStorage.getItem(`${STORAGE_PREFIX}token_endpoint`);
	if (!code || !state || state !== saved || !verifier || !clientId || !tokenEndpoint) {
		throw new Error('Sign-in could not be completed.');
	}
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		code_verifier: verifier,
		client_id: clientId,
		redirect_uri: `${window.location.origin}/oauth/callback`
	});
	const resource = sessionStorage.getItem(`${STORAGE_PREFIX}resource`);
	if (resource) body.set('resource', resource);
	const res = await fetch(tokenEndpoint, {
		method: 'POST',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body
	});
	const token = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
	if (!res.ok || !token.access_token) {
		throw new Error(exchangeFailed(res.status, token.error || res.statusText));
	}
	await openBearer(token.access_token);
}
