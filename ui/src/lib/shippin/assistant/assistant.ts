import { authorization } from '../../adapter/session';
import type { AiDraft, AiSettings, Turn } from './assistant-call';

export * from './assistant-call';

async function call<T>(method: string, path: string, fallback: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch(`/api/${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const reply = (await res.json().catch(() => null)) as (T & { message?: string; detail?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? reply?.detail ?? fallback);
	return reply;
}

export async function assistantEnabled(): Promise<boolean> {
	try {
		return (await call<{ enabled: boolean }>('GET', 'assistant', '')).enabled;
	} catch {
		return false;
	}
}

export async function askAssistant(messages: Turn[], page: string): Promise<string> {
	return (await call<{ answer: string }>('POST', 'assistant', 'The assistant could not answer just now.', { messages, page })).answer;
}

export function loadAiSettings(): Promise<AiSettings> {
	return call('GET', 'ai/settings', 'The AI settings could not be loaded.');
}

export function saveAiSettings(draft: AiDraft): Promise<unknown> {
	return call('POST', 'ai/settings', 'The AI settings could not be saved.', draft);
}

export function clearAiSettings(): Promise<unknown> {
	return call('DELETE', 'ai/settings', 'The AI settings could not be removed.');
}

export async function testAi(): Promise<string> {
	return (await call<{ answer: string }>('POST', 'ai/test', 'That did not work.')).answer;
}
