import { authorization } from './session';

/** True while the server still accepts its first-run setup key. */
export async function setupPending(): Promise<boolean> {
	const res = await fetch('/api/setup', { cache: 'no-store', headers: { Accept: 'application/json' } });
	if (!res.ok) return false;
	const body = (await res.json().catch(() => ({}))) as { pending?: unknown };
	return body.pending === true;
}

export async function createAdministrator(email: string, password: string): Promise<string> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch('/api/setup/admin', {
		method: 'POST',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ email, password })
	});
	const body = (await res.json().catch(() => ({}))) as { email?: string; message?: string };
	if (!res.ok || !body.email) throw new Error(body.message || `The server answered ${res.status}.`);
	return body.email;
}
