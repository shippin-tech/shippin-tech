/** Pure helpers for recovering deleted accounts and messages; the calls are in shippin/recover/recover.ts. */

export type HeldAccount = { id: string; name: string; email: string; kind: string; deletedAt: number; until: number };

export type KeptMessage = { id: string; subject: string; from: string; receivedAt: number; deletedAt: number; until: number; size: number };

export const KEPT_PAGE = 100;

const DAY = 86400;

/** How long something is still kept, from seconds since the epoch. */
export function keptFor(until: number, now: number): string {
	const days = Math.ceil((until - now) / DAY);
	if (days <= 0) return 'Going away today';
	return days === 1 ? 'Kept for 1 more day' : `Kept for ${days} more days`;
}

export function messageSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function keptIntro(days: number): string {
	if (days === 0) return 'Deleted accounts and messages are not being kept on this server.';
	return days === 1 ? 'Deleted accounts and messages are kept for 1 day.' : `Deleted accounts and messages are kept for ${days} days.`;
}

export function subjectOrPlaceholder(subject: string): string {
	return subject.trim() || 'No subject';
}
