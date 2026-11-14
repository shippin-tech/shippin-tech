import { authorization } from './session';
import type { Progress } from '../mcpl/lessons';

/** MCPL lesson progress kept on the server (`GET /api/learn/progress`), per signed-in person. */
export async function fetchLessonProgress(): Promise<Record<string, Progress> | null> {
	const auth = authorization();
	if (!auth) return null;
	try {
		const res = await fetch('/api/learn/progress', {
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { Authorization: auth, Accept: 'application/json' }
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { lessons?: Record<string, Progress> };
		return body.lessons && typeof body.lessons === 'object' ? body.lessons : null;
	} catch {
		return null;
	}
}

/** Adds finished steps on the server; the server never takes finished steps away. */
export async function pushLessonProgress(lesson: string, progress: Progress): Promise<Progress | null> {
	const auth = authorization();
	if (!auth) return null;
	try {
		const res = await fetch(`/api/learn/progress/${encodeURIComponent(lesson)}`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ done: progress.done, dismissed: progress.dismissed })
		});
		return res.ok ? ((await res.json()) as Progress) : null;
	} catch {
		return null;
	}
}
