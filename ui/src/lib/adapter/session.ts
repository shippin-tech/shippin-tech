const BASIC = 'shippin-basic';
const BEARER = 'shippin-bearer';
const ACCOUNT = 'shippin-account';
const RETURN_TO = 'shippin-return-to';
const SESSION_EVENT = 'shippin:session-changed';

export type Account = {
	username: string;
	accountId: string;
};

type SessionDocument = {
	accounts?: Record<string, unknown>;
	primaryAccounts?: Record<string, string>;
};

function notifySessionChanged() {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

function normalizeReturnPath(path: string | null | undefined): string | null {
	if (!path) return null;
	if (!path.startsWith('/')) return null;
	if (path.startsWith('//')) return null;
	try {
		const parsed = new URL(path, window.location.origin);
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return null;
	}
}

export function sessionEventName(): string {
	return SESSION_EVENT;
}

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

export function rememberReturnPath(path: string | null | undefined): void {
	if (typeof sessionStorage === 'undefined') return;
	const normalized = normalizeReturnPath(path);
	if (!normalized) {
		sessionStorage.removeItem(RETURN_TO);
		return;
	}
	sessionStorage.setItem(RETURN_TO, normalized);
}

export function consumeReturnPath(fallback = '/portal'): string {
	if (typeof sessionStorage === 'undefined') return fallback;
	const raw = sessionStorage.getItem(RETURN_TO);
	sessionStorage.removeItem(RETURN_TO);
	return normalizeReturnPath(raw) ?? fallback;
}

export function clearSession() {
	sessionStorage.removeItem(BASIC);
	sessionStorage.removeItem(BEARER);
	sessionStorage.removeItem(ACCOUNT);
	notifySessionChanged();
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
	sessionStorage.removeItem(BEARER);
	sessionStorage.setItem(ACCOUNT, JSON.stringify(next));
	notifySessionChanged();
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
	notifySessionChanged();
	return next;
}
