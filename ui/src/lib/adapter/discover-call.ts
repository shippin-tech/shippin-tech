export const UNCONFIGURED =
	'Sign-in is not configured: the identity provider does not support client metadata documents and no OAuth client id is configured for this application.';

export const STORAGE_PREFIX = 'shippin-oauth-';

export type DiscoveryDocument = {
	authorization_endpoint?: string;
	token_endpoint?: string;
	end_session_endpoint?: string;
	client_id_metadata_document_supported?: boolean;
	scopes_supported?: string[];
	stalwart_required_scopes?: unknown;
	protected_resources?: unknown;
};

export type DiscoverNext =
	| { step: 'register'; redirectUri: string; scope: string }
	| { step: 'unconfigured'; message: string }
	| { step: 'redirect'; url: string; store: Record<string, string> };

export function callbackUri(origin: string, basePath: string): string {
	return `${origin.replace(/\/+$/, '')}${basePath.replace(/\/+$/, '')}/oauth/callback`;
}

export function registrationBody(redirectUri: string, scope: string) {
	return {
		redirect_uris: [redirectUri],
		token_endpoint_auth_method: 'none',
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		client_name: 'ShippinTECH Web Interface',
		scope
	};
}

export function discoveryFailed(username: string, status: number, statusText: string): string {
	return `Discovery failed for "${username}": ${status} ${statusText}`;
}

export function clientIdFor(
	document: DiscoveryDocument,
	metaClientId: string | null,
	origin: string,
	basePath: string
): string | null {
	const meta = metaClientId?.trim();
	if (meta) return meta;
	if (document.client_id_metadata_document_supported === true) {
		const parts = basePath.split('/').filter((part) => part.length > 0);
		return [origin.replace(/\/+$/, ''), ...parts, 'oauth-client.json'].join('/');
	}
	return null;
}

export function scopeFor(document: DiscoveryDocument, metaScopes: string[] = []): string {
	const required = document.stalwart_required_scopes;
	const named = Array.isArray(required)
		? required.filter((item): item is string => typeof item === 'string' && item.length > 0)
		: document.scopes_supported?.includes('openid')
			? ['openid']
			: [];
	return [...new Set([...named, ...metaScopes])].join(' ');
}

export function isLocalLogin(endpoint: string, origin: string): boolean {
	if (endpoint.startsWith('/')) {
		const path = endpoint.split('?')[0].replace(/\/+$/, '') || '/';
		return path === '/login';
	}
	try {
		const url = new URL(endpoint);
		return url.origin === origin && (url.pathname.replace(/\/+$/, '') || '/') === '/login';
	} catch {
		return false;
	}
}

function resourceFor(apiOrigin: string, document: DiscoveryDocument): string | null {
	let origin: string;
	try {
		const url = new URL(apiOrigin);
		if (url.protocol !== 'https:') return null;
		origin = url.origin;
	} catch {
		return null;
	}
	const resources = document.protected_resources;
	if (Array.isArray(resources) && !resources.includes(origin)) return null;
	return origin;
}

export function nextAfterDiscover(input: {
	document: DiscoveryDocument;
	username: string;
	metaClientId: string | null;
	origin: string;
	basePath: string;
	apiOrigin: string;
	codeVerifier?: string;
	codeChallenge?: string;
	state?: string;
}): DiscoverNext {
	const clientId = clientIdFor(input.document, input.metaClientId, input.origin, input.basePath);
	const endpoint = input.document.authorization_endpoint ?? '';
	if (!clientId) {
		if (isLocalLogin(endpoint, input.origin)) {
			return {
				step: 'register',
				redirectUri: callbackUri(input.origin, input.basePath),
				scope: scopeFor(input.document)
			};
		}
		return { step: 'unconfigured', message: UNCONFIGURED };
	}
	if (!input.codeVerifier || !input.codeChallenge || !input.state) {
		return { step: 'unconfigured', message: UNCONFIGURED };
	}
	const redirectUri = callbackUri(input.origin, input.basePath);
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		code_challenge: input.codeChallenge,
		code_challenge_method: 'S256',
		state: input.state,
		login_hint: input.username,
		prompt: 'login'
	});
	const scope = scopeFor(input.document);
	if (scope) params.set('scope', scope);
	const resource = resourceFor(input.apiOrigin, input.document);
	if (resource) params.set('resource', resource);
	const target = new URL(endpoint || '/login', input.origin);
	const url = `${target.origin}${target.pathname}?${params.toString()}`;
	const store: Record<string, string> = {
		[`${STORAGE_PREFIX}code_verifier`]: input.codeVerifier,
		[`${STORAGE_PREFIX}token_endpoint`]: input.document.token_endpoint ?? '',
		[`${STORAGE_PREFIX}state`]: input.state,
		[`${STORAGE_PREFIX}return_url`]: '',
		[`${STORAGE_PREFIX}client_id`]: clientId
	};
	if (input.document.end_session_endpoint) {
		store[`${STORAGE_PREFIX}end_session_endpoint`] = input.document.end_session_endpoint;
	}
	if (resource) store[`${STORAGE_PREFIX}resource`] = resource;
	return { step: 'redirect', url, store };
}
