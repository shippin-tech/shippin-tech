/**
 * MCPL v0 lessons (mcpl/schema/lesson.schema.json): self-teaching scripts whose steps
 * finish on real app events. A lesson never fakes progress and never acts for anyone.
 */
import { writable } from 'svelte/store';
import type { PortalSignal } from '../portal/signal';
import keepYourContacts from './lessons/keep-your-contacts.json';
import linkGoogleDrive from './lessons/link-google-drive.json';
import runYourTeam from './lessons/run-your-team.json';
import watchYourServer from './lessons/watch-your-server.json';
import maskYourAddress from './lessons/mask-your-address.json';
import runYourOrganisation from './lessons/run-your-organisation.json';
import setUpAnOrganisation from './lessons/set-up-an-organisation.json';
import turnOnTheAssistant from './lessons/turn-on-the-assistant.json';
import authorYourKeys from './lessons/author-your-keys.json';
import shapeYourOrganisation from './lessons/shape-your-organisation.json';
import setUpYourDomain from './lessons/set-up-your-domain.json';
import useYourCalendar from './lessons/use-your-calendar.json';
import useYourDrive from './lessons/use-your-drive.json';
import writeADocument from './lessons/write-a-document.json';

export type LessonStep = { id: string; say: string; where?: string; doneWhen: string };
export type Lesson = { id: string; title: string; audience: 'guest' | 'user' | 'owner' | 'admin'; steps: LessonStep[] };
export type Progress = { done: string[]; dismissed: boolean };

export const LESSONS: readonly Lesson[] = [setUpYourDomain as Lesson, useYourDrive as Lesson, useYourCalendar as Lesson, keepYourContacts as Lesson, writeADocument as Lesson, linkGoogleDrive as Lesson, runYourTeam as Lesson, watchYourServer as Lesson, maskYourAddress as Lesson, runYourOrganisation as Lesson, setUpAnOrganisation as Lesson, turnOnTheAssistant as Lesson, shapeYourOrganisation as Lesson, authorYourKeys as Lesson];

export const emptyProgress = (): Progress => ({ done: [], dismissed: false });

/** Marks every unfinished step this event completes. Order does not matter: people skip ahead. */
export function advance(lesson: Lesson, progress: Progress, event: Pick<PortalSignal, 'channel' | 'eventType'>): Progress {
	if (event.channel !== 'app') return progress;
	const finished = lesson.steps.filter((step) => step.doneWhen === event.eventType && !progress.done.includes(step.id));
	if (finished.length === 0) return progress;
	return { ...progress, done: [...progress.done, ...finished.map((step) => step.id)] };
}

export function nextStep(lesson: Lesson, progress: Progress): LessonStep | undefined {
	return lesson.steps.find((step) => !progress.done.includes(step.id));
}

export function complete(lesson: Lesson, progress: Progress): boolean {
	return lesson.steps.every((step) => progress.done.includes(step.id));
}

// ---- per-account persistence -------------------------------------------------------

const key = (account: string, lesson: Lesson) => `mcpl:lesson:${account}:${lesson.id}`;

export function loadProgress(account: string, lesson: Lesson): Progress {
	try {
		const raw = localStorage.getItem(key(account, lesson));
		const parsed = raw ? (JSON.parse(raw) as Partial<Progress>) : {};
		return { done: Array.isArray(parsed.done) ? parsed.done.filter((id) => typeof id === 'string') : [], dismissed: parsed.dismissed === true };
	} catch {
		return emptyProgress();
	}
}

export function saveProgress(account: string, lesson: Lesson, progress: Progress): void {
	try {
		localStorage.setItem(key(account, lesson), JSON.stringify(progress));
	} catch {
		// Private windows and blocked storage: progress lasts for this page only.
	}
}

/** Finished steps from either side stay finished; dismissal follows the server's word unless only the browser knows it. */
export function mergeProgress(local: Progress, server: Progress | undefined): Progress {
	if (!server) return local;
	const done = [...server.done.filter((id) => typeof id === 'string')];
	for (const id of local.done) if (!done.includes(id)) done.push(id);
	return { done, dismissed: server.dismissed || local.dismissed };
}

/**
 * Brings this browser and the server's copy of every lesson together after sign-in:
 * the merged progress is saved here and sent back when the server lacked part of it.
 */
export async function syncLessons(
	account: string,
	fetchAll: () => Promise<Record<string, Progress> | null>,
	push: (lesson: string, progress: Progress) => Promise<unknown>
): Promise<boolean> {
	const server = await fetchAll();
	if (!server) return false;
	let changed = false;
	for (const lesson of LESSONS) {
		const local = loadProgress(account, lesson);
		const merged = mergeProgress(local, server[lesson.id]);
		const remote = server[lesson.id];
		if (JSON.stringify(merged) !== JSON.stringify(local)) {
			saveProgress(account, lesson, merged);
			changed = true;
		}
		if (!remote || merged.done.length !== remote.done.length || merged.dismissed !== remote.dismissed) {
			if (merged.done.length || merged.dismissed) await push(lesson.id, merged);
		}
	}
	if (changed) lessonsChanged.update((n) => n + 1);
	return true;
}

/** Bumped whenever stored progress changes, so mounted lessons re-read it. */
export const lessonsChanged = writable(0);

/**
 * Feeds app events to every lesson for the signed-in account. Call once from the root
 * layout. Only events published after binding count, so old in-memory events are not
 * replayed.
 */
export function bindLessons(
	subscribe: (run: (signals: PortalSignal[]) => void) => () => void,
	account: () => string | null,
	saved: (lesson: string, progress: Progress) => void = () => {}
): () => void {
	let seen: Set<string> | null = null;
	return subscribe((signals) => {
		if (seen === null) {
			seen = new Set(signals.map((signal) => signal.id));
			return;
		}
		const fresh = signals.filter((signal) => !seen!.has(signal.id));
		for (const signal of fresh) seen.add(signal.id);
		const who = account();
		if (!who || fresh.length === 0) return;
		let changed = false;
		for (const lesson of LESSONS) {
			const before = loadProgress(who, lesson);
			const after = fresh.reduce((progress, signal) => advance(lesson, progress, signal), before);
			if (after !== before) {
				saveProgress(who, lesson, after);
				saved(lesson.id, after);
				changed = true;
			}
		}
		if (changed) lessonsChanged.update((n) => n + 1);
	});
}
