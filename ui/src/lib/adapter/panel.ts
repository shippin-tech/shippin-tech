import { authorization, clearSession } from './session';
import type { DnsCheck, DomainView, Mailbox, PanelPlan, VerifyRecord } from '$lib/panel/model';

const BASE = '/api/panel';

export class PanelError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (init.body !== undefined) headers['Content-Type'] = 'application/json';
	if (init.auth !== false) {
		const auth = authorization();
		if (!auth) throw new PanelError('signedOut', 'sign-in required', 401);
		headers.Authorization = auth;
	}
	const res = await fetch(`${BASE}${path}`, {
		method: init.method ?? 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body)
	});
	if (res.status === 401 && init.auth !== false) {
		clearSession();
		throw new PanelError('signedOut', 'sign-in required', 401);
	}
	const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) {
		const message =
			typeof payload.message === 'string'
				? payload.message
				: typeof payload.detail === 'string'
					? payload.detail
					: res.status === 429
						? 'Too many attempts. Wait a few minutes and try again.'
						: `The server answered ${res.status}.`;
		throw new PanelError(typeof payload.error === 'string' ? payload.error : `http${res.status}`, message, res.status);
	}
	return payload as T;
}

export const loadPlan = () => call<PanelPlan>('/plan', { auth: false });

export const requestVerifyRecord = (domain: string) =>
	call<{ domain: string; record: VerifyRecord; dnsProof: boolean }>('/signup/code', {
		method: 'POST',
		body: { domain },
		auth: false
	});

export const completeSignup = (domain: string, name: string, password: string) =>
	call<{ email: string; domain: string }>('/signup', { method: 'POST', body: { domain, name, password }, auth: false });

export const loadDomain = () => call<DomainView>('/domain');

export const loadDnsStatus = () => call<{ records: DnsCheck[] }>('/dns').then((r) => r.records);

export const setCatchAll = (mailbox: string) =>
	call<{ catchAll: string | null }>('/domain/catchall', { method: 'POST', body: { mailbox } });

export const closeDomain = (confirm: string) =>
	call<{ closed: string }>('/domain/close', { method: 'POST', body: { confirm } });

export const loadMailboxes = () => call<{ mailboxes: Mailbox[] }>('/mailboxes').then((r) => r.mailboxes);

export const createMailbox = (name: string, password: string) =>
	call<{ id: string; email: string }>('/mailboxes', { method: 'POST', body: { name, password } });

export const deleteMailbox = (id: string) => call(`/mailboxes/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const setMailboxPassword = (id: string, password: string) =>
	call(`/mailboxes/${encodeURIComponent(id)}/password`, { method: 'POST', body: { password } });

export const addAlias = (id: string, alias: string) =>
	call<{ alias: string }>(`/mailboxes/${encodeURIComponent(id)}/aliases`, { method: 'POST', body: { alias } });

export const removeAlias = (id: string, alias: string) =>
	call(`/mailboxes/${encodeURIComponent(id)}/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' });
