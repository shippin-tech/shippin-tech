import {
	STORAGE_PREFIX,
	UNCONFIGURED,
	clientIdFor,
	discoveryFailed,
	nextAfterDiscover,
	registrationBody,
	type DiscoverNext,
	type DiscoveryDocument
} from './discover-call';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function verifier(): string {
	const length = 64;
	const bytes = new Uint8Array(length * 2);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let index = 0; index < bytes.length && out.length < length; index += 1) {
		const byte = bytes[index];
		if (byte < 198) out += alphabet[byte % alphabet.length];
	}
	if (out.length < length) throw new Error('Could not build a code verifier.');
	return out;
}

function state(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function challenge(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	let binary = '';
	for (const byte of new Uint8Array(digest)) binary += String.fromCodePoint(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function meta(name: string): string | null {
	return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || null;
}

export async function requestDiscover(username: string): Promise<DiscoverNext> {
	const res = await fetch(`/api/discover/${encodeURIComponent(username)}`, {
		cache: 'no-store',
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(discoveryFailed(username, res.status, res.statusText));
	const document = (await res.json()) as DiscoveryDocument;
	const origin = window.location.origin;
	let metaClientId = meta('oauth-client-id');
	const preview = nextAfterDiscover({
		document,
		username,
		metaClientId,
		origin,
		basePath: '/',
		apiOrigin: origin
	});
	if (preview.step === 'register') {
		metaClientId = await publicClient(preview.redirectUri, preview.scope);
	}
	const codeVerifier = clientIdFor(document, metaClientId, origin, '/') ? verifier() : undefined;
	return nextAfterDiscover({
		document,
		username,
		metaClientId,
		origin,
		basePath: '/',
		apiOrigin: origin,
		codeVerifier,
		codeChallenge: codeVerifier ? await challenge(codeVerifier) : undefined,
		state: codeVerifier ? state() : undefined
	});
}

async function publicClient(redirectUri: string, scope: string): Promise<string> {
	const key = `${STORAGE_PREFIX}client:${redirectUri}`;
	const cached = localStorage.getItem(key);
	if (cached) return cached;
	const res = await fetch('/auth/register', {
		method: 'POST',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(registrationBody(redirectUri, scope))
	});
	if (!res.ok) throw new Error(UNCONFIGURED);
	const body = (await res.json()) as { client_id?: string };
	if (!body.client_id) throw new Error(UNCONFIGURED);
	localStorage.setItem(key, body.client_id);
	return body.client_id;
}
