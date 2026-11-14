import { beforeEach, describe, expect, it } from 'vitest';
import { writable } from 'svelte/store';
import { appEvent } from '../src/lib/mcpl/events';
import { createSignal, type PortalSignal } from '../src/lib/portal/signal';
import {
	LESSONS,
	advance,
	bindLessons,
	complete,
	emptyProgress,
	loadProgress,
	nextStep,
	saveProgress,
	type Lesson
} from '../src/lib/mcpl/lessons';

const lesson = LESSONS.find((l) => l.id === 'set-up-your-domain') as Lesson;
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

describe('MCPL app events', () => {
	it('uses the app channel and a completed status', () => {
		const event = appEvent('panel.mailbox.created', 'example.com');
		expect(event.channel).toBe('app');
		expect(event.status).toBe('completed');
		expect(event.eventType).toBe('panel.mailbox.created');
	});
});

describe('lessons', () => {
	it('advance only on app events, in any order', () => {
		let progress = emptyProgress();
		progress = advance(lesson, progress, createSignal({ channel: 'scripted', eventType: 'panel.mailbox.created', resource: 'x', status: 'completed', severity: 'info' }));
		expect(progress.done).toEqual([]);
		progress = advance(lesson, progress, appEvent('mail.message.sent', 'me@example.com'));
		expect(progress.done).toEqual(['send-first-message']);
		expect(nextStep(lesson, progress)?.id).toBe('publish-dns');
		progress = advance(lesson, progress, appEvent('mail.message.sent', 'me@example.com'));
		expect(progress.done).toEqual(['send-first-message']);
	});

	it('is complete when every step has its event', () => {
		let progress = emptyProgress();
		for (const step of lesson.steps) progress = advance(lesson, progress, appEvent(step.doneWhen, 'x'));
		expect(complete(lesson, progress)).toBe(true);
		expect(nextStep(lesson, progress)).toBeUndefined();
	});

	it('keeps progress per account', () => {
		saveProgress('a@example.com', lesson, { done: ['add-mailbox'], dismissed: false });
		expect(loadProgress('a@example.com', lesson).done).toEqual(['add-mailbox']);
		expect(loadProgress('b@example.com', lesson).done).toEqual([]);
	});

	it('counts only events published after binding, so old events are not replayed', () => {
		const store = writable<PortalSignal[]>([appEvent('panel.mailbox.created', 'old')]);
		const unbind = bindLessons(store.subscribe, () => 'owner@example.com');
		expect(loadProgress('owner@example.com', lesson).done).toEqual([]);
		store.update((s) => [...s, appEvent('panel.dns.published', 'example.com')]);
		expect(loadProgress('owner@example.com', lesson).done).toEqual(['publish-dns']);
		unbind();
	});

	it('does nothing while nobody is signed in', () => {
		const store = writable<PortalSignal[]>([]);
		const unbind = bindLessons(store.subscribe, () => null);
		store.update((s) => [...s, appEvent('panel.dns.published', 'example.com')]);
		expect(memory.size).toBe(0);
		unbind();
	});
});
