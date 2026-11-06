/**
 * Proves discover follows the portal document.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-discover.ts
 */
import { readFileSync } from 'node:fs';
import {
	UNCONFIGURED,
	discoveryFailed,
	nextAfterDiscover,
	registrationBody,
	type DiscoveryDocument
} from '../src/lib/adapter/discover-call.ts';

const local: DiscoveryDocument = {
	issuer: '',
	authorization_endpoint: '/login',
	token_endpoint: '/auth/token',
	scopes_supported: ['openid', 'offline_access']
};

const registered = nextAfterDiscover({
	document: local,
	username: 'admin@example.org',
	metaClientId: null,
	origin: 'http://127.0.0.1:5175',
	basePath: '/',
	apiOrigin: 'http://127.0.0.1:5175'
});
if (registered.step !== 'register' || !registered.redirectUri.endsWith('/oauth/callback')) {
	throw new Error('local document should register a public client');
}
if (registered.scope !== 'openid') throw new Error('scope');

const body = registrationBody(registered.redirectUri, registered.scope);
if (body.token_endpoint_auth_method !== 'none' || body.redirect_uris[0] !== registered.redirectUri) {
	throw new Error('registration body');
}

const redirect = nextAfterDiscover({
	document: local,
	username: 'admin@example.org',
	metaClientId: 'swc1.example',
	origin: 'http://127.0.0.1:5175',
	basePath: '/',
	apiOrigin: 'http://127.0.0.1:5175',
	codeVerifier: 'verifier-value',
	codeChallenge: 'challenge-value',
	state: 'state-value'
});
if (redirect.step !== 'redirect') throw new Error('client id should redirect home');
const localUrl = new URL(redirect.url);
if (localUrl.origin !== 'http://127.0.0.1:5175' || localUrl.pathname !== '/login') {
	throw new Error('authorization stays on this login');
}
if (localUrl.searchParams.get('client_id') !== 'swc1.example') throw new Error('issued client');
if (localUrl.searchParams.get('redirect_uri') !== 'http://127.0.0.1:5175/oauth/callback') {
	throw new Error('callback');
}
if (localUrl.searchParams.get('code_challenge_method') !== 'S256') throw new Error('pkce');

const external = nextAfterDiscover({
	document: { authorization_endpoint: 'https://idp.example/authorize', token_endpoint: 'https://idp.example/token' },
	username: 'admin@example.org',
	metaClientId: null,
	origin: 'http://127.0.0.1:5175',
	basePath: '/',
	apiOrigin: 'http://127.0.0.1:5175'
});
if (external.step !== 'unconfigured' || external.message !== UNCONFIGURED) {
	throw new Error('external document without a client id');
}

const remote = nextAfterDiscover({
	document: {
		authorization_endpoint: 'https://idp.example/authorize',
		token_endpoint: 'https://idp.example/token',
		client_id_metadata_document_supported: true,
		scopes_supported: ['openid']
	},
	username: 'admin@example.org',
	metaClientId: null,
	origin: 'http://127.0.0.1:5175',
	basePath: '/',
	apiOrigin: 'https://mail.example',
	codeVerifier: 'verifier-value',
	codeChallenge: 'challenge-value',
	state: 'state-value'
});
if (remote.step !== 'redirect') throw new Error('client metadata should redirect');
const url = new URL(remote.url);
if (url.origin !== 'https://idp.example') throw new Error('authorization host');
if (url.searchParams.get('response_type') !== 'code') throw new Error('response type');
if (url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('pkce');
if (url.searchParams.get('login_hint') !== 'admin@example.org') throw new Error('login hint');
if (url.searchParams.get('client_id') !== 'http://127.0.0.1:5175/oauth-client.json') throw new Error('client id');
if (url.searchParams.get('scope') !== 'openid') throw new Error('scope');
if (remote.store['shippin-oauth-code_verifier'] !== 'verifier-value') throw new Error('verifier store');
if (url.searchParams.get('resource') !== 'https://mail.example') throw new Error('resource');

if (discoveryFailed('admin@example.org', 404, 'Not Found') !== 'Discovery failed for "admin@example.org": 404 Not Found') {
	throw new Error('failure sentence');
}

const login = readFileSync(new URL('../src/routes/(account)/login/+page.svelte', import.meta.url), 'utf8');
if (!login.includes('requestDiscover') || login.includes('openSession')) {
	throw new Error('login still opens a session before the code flow');
}
const callback = readFileSync(
	new URL('../src/routes/(account)/oauth/callback/+page.svelte', import.meta.url),
	'utf8'
);
if (!callback.includes('exchangeAuthorizationCode')) throw new Error('callback does not exchange');

const catalog = readFileSync(new URL('../src/lib/catalog/login/Login.svelte', import.meta.url), 'utf8');
if (catalog.includes('discover') || catalog.includes('$lib/adapter')) throw new Error('catalog fetches');

console.log('ok');
