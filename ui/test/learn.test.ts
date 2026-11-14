import { beforeEach, describe, expect, it } from 'vitest';
import { LESSONS, loadProgress, mergeProgress, saveProgress, syncLessons, type Progress } from '../src/lib/mcpl/lessons';

const lesson = LESSONS[0];
const memory = new Map<string, string>();
beforeEach(() => {
	memory.clear();
	globalThis.localStorage = {
		getItem: (k: string) => memory.get(k) ?? null,
		setItem: (k: string, v: string) => void memory.set(k, v),
		removeItem: (k: string) => void memory.delete(k),
		clear: () => memory.clear(),
		key: () => null,
		length: 0
	} as Storage;
});

describe('lesson progress on the server', () => {
	it('keeps every finished step from both sides', () => {
		expect(mergeProgress({ done: ['a'], dismissed: false }, { done: ['b'], dismissed: false })).toEqual({
			done: ['b', 'a'],
			dismissed: false
		});
		expect(mergeProgress({ done: ['a'], dismissed: true }, undefined)).toEqual({ done: ['a'], dismissed: true });
		expect(mergeProgress({ done: [], dismissed: false }, { done: ['a'], dismissed: true }).dismissed).toBe(true);
	});

	it('a second device picks up progress made on the first', async () => {
		const server: Record<string, Progress> = { [lesson.id]: { done: ['publish-dns', 'add-mailbox'], dismissed: false } };
		const pushed: [string, Progress][] = [];
		const ok = await syncLessons('owner@x.test', async () => server, async (id, progress) => void pushed.push([id, progress]));
		expect(ok).toBe(true);
		expect(loadProgress('owner@x.test', lesson).done).toEqual(['publish-dns', 'add-mailbox']);
		expect(pushed).toEqual([]);
	});

	it('steps finished offline are sent up, and nothing is sent when there is nothing to say', async () => {
		saveProgress('owner@x.test', lesson, { done: ['send-first-message'], dismissed: false });
		const pushed: [string, Progress][] = [];
		await syncLessons('owner@x.test', async () => ({ [lesson.id]: { done: ['publish-dns'], dismissed: false } }), async (id, p) => void pushed.push([id, p]));
		expect(pushed).toEqual([[lesson.id, { done: ['publish-dns', 'send-first-message'], dismissed: false }]]);

		memory.clear();
		const none: [string, Progress][] = [];
		await syncLessons('fresh@x.test', async () => ({}), async (id, p) => void none.push([id, p]));
		expect(none).toEqual([]);
		expect(await syncLessons('x', async () => null, async () => undefined)).toBe(false);
	});
});
