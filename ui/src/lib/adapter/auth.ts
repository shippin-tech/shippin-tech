import { paths } from './paths';

export type OAuthQuery = {
	clientId: string;
	redirectUri: string | null;
	scope: string | null;
	state: string | null;
	nonce: string | null;
	codeChallenge: string | null;
	codeChallengeMethod: string | null;
	resource: string[];
};

export type AuthFields = {
	username: string;
	password: string;
	deviceCode: string;
	otp: string;
};

export type AuthResponse = {
	type?: string;
	client_code?: string;
	iss?: string;
};

function withOptional(body: Record<string, string>, key: string, value: string | null) {
	if (value) body[key] = value;
}

export function authBody(fields: AuthFields, oauth: OAuthQuery, device: boolean) {
	if (device) {
		const body: Record<string, string> = {
			type: 'authDevice',
			accountName: fields.username,
			accountSecret: fields.password,
			code: fields.deviceCode.trim()
		};
		if (fields.otp) body.mfaToken = fields.otp;
		return body;
	}
	const body: Record<string, string | string[]> = {
		type: 'authCode',
		accountName: fields.username,
		accountSecret: fields.password,
		clientId: oauth.clientId
	};
	withOptional(body as Record<string, string>, 'redirectUri', oauth.redirectUri);
	withOptional(body as Record<string, string>, 'scope', oauth.scope);
	withOptional(body as Record<string, string>, 'state', oauth.state);
	withOptional(body as Record<string, string>, 'nonce', oauth.nonce);
	withOptional(body as Record<string, string>, 'codeChallenge', oauth.codeChallenge);
	withOptional(body as Record<string, string>, 'codeChallengeMethod', oauth.codeChallengeMethod);
	if (oauth.resource.length) body.resource = oauth.resource;
	if (fields.otp) body.mfaToken = fields.otp;
	return body;
}

export async function postAuth(body: Record<string, string | string[]>): Promise<AuthResponse> {
	const res = await fetch(paths.auth, {
		method: 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(body)
	});
	if (res.status !== 200) {
		throw new Error('http ' + res.status);
	}
	return res.json();
}
