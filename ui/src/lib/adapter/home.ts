import { authorization } from './session';

/** guest: signed out. user: a mailbox. owner: runs a self-service domain. admin: operates the server. */
export type Role = 'guest' | 'user' | 'owner' | 'org' | 'admin';

const ADMIN_PERMISSIONS = ['sysDomainCreate', 'sysAccountCreate'];

let cached: { auth: string; role: Role } | null = null;

export async function currentRole(): Promise<Role> {
	const auth = authorization();
	if (!auth) return 'guest';
	if (cached?.auth === auth) return cached.role;
	const headers = { Authorization: auth, Accept: 'application/json' };
	let role: Role = 'user';
	try {
		const org = await fetch('/api/org', { headers, cache: 'no-store', credentials: 'same-origin' });
		if (org.ok) {
			cached = { auth, role: 'org' };
			return 'org';
		}
		const panel = await fetch('/api/panel/domain', { headers, cache: 'no-store', credentials: 'same-origin' });
		if (panel.ok) role = 'owner';
		else {
			const res = await fetch('/api/account', { headers, cache: 'no-store', credentials: 'same-origin' });
			if (res.status === 401) return 'guest';
			const body = (await res.json().catch(() => ({}))) as { permissions?: unknown };
			const permissions = Array.isArray(body.permissions) ? body.permissions : [];
			if (ADMIN_PERMISSIONS.some((p) => permissions.includes(p))) role = 'admin';
		}
	} catch {
		return 'user';
	}
	cached = { auth, role };
	return role;
}

export function forgetRole(): void {
	cached = null;
}

export function homeFor(role: Role): string {
	switch (role) {
		case 'guest':
			return '/login';
		case 'owner':
			return '/manage';
		case 'org':
			return '/shippin/org';
		case 'admin':
			return '/shippin/admin';
		default:
			return '/mail';
	}
}

export type NavItem = { href: string; label: string };

export function navFor(role: Role, signupOpen: boolean): NavItem[] {
	const mail = [
		{ href: '/mail', label: 'Mail' },
		{ href: '/calendar', label: 'Calendar' },
		{ href: '/contacts', label: 'Contacts' },
		{ href: '/account', label: 'Account' }
	];
	switch (role) {
		case 'guest':
			return signupOpen ? [{ href: '/signup', label: 'Create free account' }] : [];
		case 'owner':
			return [{ href: '/manage', label: 'My domain' }, ...mail];
		case 'org':
			return [{ href: '/shippin/org', label: 'Organisation' }, ...mail];
		case 'admin':
			return [
				{ href: '/shippin/admin', label: 'Admin' },
				{ href: '/platform', label: 'Platform' },
				...mail,
				{ href: '/files', label: 'Drive' },
				{ href: '/docs', label: 'Docs' }
			];
		default:
			return mail;
	}
}
