const BASIC = 'shippin-basic';
const BEARER = 'shippin-bearer';
const ACCOUNT = 'shippin-account';

export type Account = {
	username: string;
	accountId: string;
};

type SessionDocument = {
	accounts?: Record<string, unknown>;
	primaryAccounts?: Record<string, string>;
};

export function authorization(): string | null {
	if (typeof sessionStorage === 'undefined') return null;
	const bearer = sessionStorage.getItem(BEARER);
	if (bearer) return `Bearer ${bearer}`;
	const token = sessionStorage.getItem(BASIC);
	return token ? `Basic ${token}` : null;
}

export function account(): Account | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(ACCOUNT);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Account;
	} catch {
		return null;
	}
}

export function clearSession() {
	sessionStorage.removeItem(BASIC);
	sessionStorage.removeItem(BEARER);
	sessionStorage.removeItem(ACCOUNT);
}

function primaryAccount(session: SessionDocument): string {
	const primary = session.primaryAccounts ?? {};
	return (
		primary['urn:ietf:params:jmap:mail'] ||
		Object.values(primary)[0] ||
		Object.keys(session.accounts ?? {})[0] ||
		''
	);
}

export async function openSession(username: string, password: string): Promise<Account> {
	const token = btoa(`${username}:${password}`);
	const res = await fetch('/jmap/session', {
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: `Basic ${token}`, Accept: 'application/json' }
	});
	if (res.status === 401) throw new Error('invalid');
	if (!res.ok) throw new Error('http ' + res.status);
	const session = (await res.json()) as SessionDocument;
	const next: Account = { username, accountId: primaryAccount(session) };
	sessionStorage.setItem(BASIC, token);
	sessionStorage.setItem(ACCOUNT, JSON.stringify(next));
	return next;
}

export async function openBearer(accessToken: string): Promise<Account> {
	const res = await fetch('/jmap/session', {
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
	});
	if (res.status === 401) throw new Error('invalid');
	if (!res.ok) throw new Error('http ' + res.status);
	const session = (await res.json()) as SessionDocument;
	const username =
		(session.accounts &&
			Object.values(session.accounts).find(
				(item): item is { name: string } =>
					!!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
			)?.name) ||
		'';
	const next: Account = { username, accountId: primaryAccount(session) };
	sessionStorage.removeItem(BASIC);
	sessionStorage.setItem(BEARER, accessToken);
	sessionStorage.setItem(ACCOUNT, JSON.stringify(next));
	return next;
}
