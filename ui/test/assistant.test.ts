import { describe, expect, it } from 'vitest';
import { aiProblem, endpointHint, MAX_TURNS, turnsToSend, type Turn } from '../src/lib/shippin/assistant/assistant-call';

const user = (content: string): Turn => ({ role: 'user', content });
const bot = (content: string): Turn => ({ role: 'assistant', content });

describe('assistant helpers', () => {
	it('sends only the newest turns and always starts with the person', () => {
		const long: Turn[] = [];
		for (let i = 0; i < MAX_TURNS; i += 1) long.push(user(`q${i}`), bot(`a${i}`));
		long.push(user('last'));
		const sent = turnsToSend(long);
		expect(sent.length).toBeLessThanOrEqual(MAX_TURNS);
		expect(sent[0].role).toBe('user');
		expect(sent.at(-1)).toEqual(user('last'));
		expect(turnsToSend([bot('hello')])).toEqual([]);
	});

	it('checks the settings before saving', () => {
		const draft = { kind: 'openai' as const, endpoint: 'http://ollama:11434/v1', model: 'llama', key: '', assistant: true };
		expect(aiProblem(draft)).toBe('');
		expect(aiProblem({ ...draft, endpoint: 'ollama:11434' })).toMatch(/starts with/);
		expect(aiProblem({ ...draft, model: ' ' })).toMatch(/model/);
	});

	it('suggests the right kind of address', () => {
		expect(endpointHint('anthropic')).toContain('anthropic.com');
		expect(endpointHint('openai')).toContain('/v1');
	});
});
