/** Pure helpers for the assistant; the calls are in assistant.ts. */

export type Turn = { role: 'user' | 'assistant'; content: string };

export const MAX_TURNS = 12;

/** What to send: the newest turns that fit, starting with something the person said. */
export function turnsToSend(turns: readonly Turn[]): Turn[] {
	const recent = turns.slice(-MAX_TURNS);
	const first = recent.findIndex((turn) => turn.role === 'user');
	return first === -1 ? [] : recent.slice(first);
}

export type AiKind = 'openai' | 'anthropic';

export type AiSettings = { kind: AiKind | null; endpoint: string | null; model: string | null; hasKey: boolean; assistant: boolean };

export type AiDraft = { kind: AiKind; endpoint: string; model: string; key: string; assistant: boolean };

export function aiProblem(draft: AiDraft): string {
	if (!/^https?:\/\//.test(draft.endpoint.trim())) return 'The address starts with https:// or http://.';
	if (!draft.model.trim()) return 'Enter the name of the model to use.';
	return '';
}

export function endpointHint(kind: AiKind): string {
	return kind === 'anthropic' ? 'https://api.anthropic.com' : 'http://your-server:11434/v1';
}
