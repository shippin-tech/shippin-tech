import { authorization } from '../../adapter/session';
import type { HeldAccount, KeptMessage } from './recover-call';

export * from './recover-call';

async function call<T>(method: string, path: string, fallback: string): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to recover deleted items.');
	const res = await fetch(`/api/recover/${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth }
	});
	if (res.status === 403) throw new Error('Only administrators can recover deleted items.');
	const reply = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? fallback);
	return reply;
}

export function listHeldAccounts(): Promise<{ keepDays: number; accounts: HeldAccount[] }> {
	return call('GET', 'accounts', 'Deleted accounts could not be loaded.');
}

export function restoreHeldAccount(id: string): Promise<unknown> {
	return call('POST', `accounts/${encodeURIComponent(id)}/restore`, 'The account could not be restored.');
}

export async function listKeptMessages(account: string, before?: string): Promise<KeptMessage[]> {
	const query = before === undefined ? '' : `?before=${encodeURIComponent(before)}`;
	return (await call<{ messages: KeptMessage[] }>('GET', `messages/${encodeURIComponent(account)}${query}`, 'Deleted messages could not be loaded.')).messages;
}

export function restoreKeptMessage(account: string, id: string): Promise<unknown> {
	return call('POST', `messages/${encodeURIComponent(account)}/${encodeURIComponent(id)}/restore`, 'The message could not be restored.');
}
