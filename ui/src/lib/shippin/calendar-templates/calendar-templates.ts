import { authorization } from '../../adapter/session';
import type { CalendarTemplate } from './calendar-templates-call';

export * from './calendar-templates-call';

async function call<T>(method: string, path: string, fallback: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch(`/api/calendar-templates${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (res.status === 403) throw new Error('Only administrators can change these.');
	const reply = (await res.json().catch(() => null)) as (T & { message?: string; detail?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? reply?.detail ?? fallback);
	return reply;
}

export async function loadCalendarTemplates(): Promise<CalendarTemplate[]> {
	return (await call<{ templates: CalendarTemplate[] }>('GET', '', 'The calendar emails could not be loaded.')).templates;
}

export function saveCalendarTemplate(id: string, source: string): Promise<unknown> {
	return call('POST', `/${id}`, 'The email could not be saved.', { source });
}

export function resetCalendarTemplate(id: string): Promise<unknown> {
	return call('DELETE', `/${id}`, 'The email could not be reset.');
}
