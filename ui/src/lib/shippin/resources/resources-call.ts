/** Pure helpers for the Resources page; the call is in resources.ts. */

export type UsageLevel = 'none' | 'fine' | 'near' | 'over';

export type OrgUsage = {
	id: string;
	name: string;
	domains: string[];
	people: number;
	maxPeople: number;
	peopleLevel: UsageLevel;
	storageUsed: number;
	storageHeld: number;
	maxStorage: number;
	storageLevel: UsageLevel;
};

export type ResourceReport = {
	server: { host: string; memory: number; disk: { total: number; free: number } | null; people: number; domains: number; queue: number };
	orgs: OrgUsage[];
	other: { domains: number; people: number; storageUsed: number };
};

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function bytesText(bytes: number): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** Null when there is no limit to be a percentage of. */
export function percentOf(used: number, max: number): number | null {
	return max > 0 ? Math.min(100, Math.round((used / max) * 100)) : null;
}

export function levelOf(used: number, max: number): UsageLevel {
	if (max <= 0) return 'none';
	if (used >= max) return 'over';
	return used * 10 >= max * 8 ? 'near' : 'fine';
}

const RANK: Record<UsageLevel, number> = { over: 0, near: 1, fine: 2, none: 3 };

/** Whatever needs attention first, then the biggest users of storage. */
export function sortByAttention(orgs: readonly OrgUsage[]): OrgUsage[] {
	const worst = (org: OrgUsage) => Math.min(RANK[org.peopleLevel], RANK[org.storageLevel]);
	return [...orgs].sort((a, b) => worst(a) - worst(b) || b.storageUsed - a.storageUsed || a.name.localeCompare(b.name));
}

export function diskUsed(disk: { total: number; free: number }): number {
	return Math.max(0, disk.total - disk.free);
}
