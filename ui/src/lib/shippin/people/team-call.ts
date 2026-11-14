/** Pure helpers for People and teams; the calls are in shippin/people/team.ts. */

export type TeamDomain = { id: string; name: string };

export type Person = {
	id: string;
	name: string;
	domainId: string;
	email: string;
	fullName: string;
	role: 'user' | 'admin' | 'custom';
	used: number;
	limit: number | null;
	teamIds: string[];
	passwordKey: string | null;
	createdAt: string;
};

export type Team = { id: string; name: string; domainId: string; email: string; description: string };

export type PersonDraft = {
	name: string;
	domainId: string;
	fullName: string;
	password: string;
	role: 'user' | 'admin' | 'custom';
	limitGb: string;
	teamIds: string[];
};

export type TeamDraft = { name: string; domainId: string; description: string };

const GB = 1024 ** 3;

type Raw = Record<string, unknown>;

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function toPerson(raw: Raw): Person | null {
	if (typeof raw.id !== 'string' || raw['@type'] !== 'User') return null;
	const quotas = (raw.quotas ?? {}) as Record<string, unknown>;
	const credentials = Object.entries((raw.credentials ?? {}) as Record<string, Raw>);
	const roleType = (raw.roles as Raw | undefined)?.['@type'];
	return {
		id: raw.id,
		name: text(raw.name),
		domainId: text(raw.domainId),
		email: text(raw.emailAddress),
		fullName: text(raw.description),
		role: roleType === 'Admin' ? 'admin' : roleType === 'Custom' ? 'custom' : 'user',
		used: typeof raw.usedDiskQuota === 'number' ? raw.usedDiskQuota : 0,
		limit: typeof quotas.maxDiskQuota === 'number' && quotas.maxDiskQuota > 0 ? quotas.maxDiskQuota : null,
		teamIds: Object.keys((raw.memberGroupIds ?? {}) as object),
		passwordKey: credentials.find(([, credential]) => credential?.['@type'] === 'Password')?.[0] ?? null,
		createdAt: text(raw.createdAt)
	};
}

export function toTeam(raw: Raw): Team | null {
	if (typeof raw.id !== 'string' || raw['@type'] !== 'Group') return null;
	return { id: raw.id, name: text(raw.name), domainId: text(raw.domainId), email: text(raw.emailAddress), description: text(raw.description) };
}

export function displayName(person: Person): string {
	return person.fullName || person.email || person.name;
}

export function sortPeople(people: readonly Person[]): Person[] {
	return [...people].sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }));
}

export function filterPeople(people: readonly Person[], query: string, teamId = ''): Person[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return people.filter((person) => {
		if (teamId && !person.teamIds.includes(teamId)) return false;
		const haystack = `${person.fullName} ${person.email}`.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}

export function membersOf(people: readonly Person[], teamId: string): Person[] {
	return sortPeople(people.filter((person) => person.teamIds.includes(teamId)));
}

/** Bytes for a limit typed in gigabytes; null for none, undefined when it makes no sense. */
export function limitBytes(gigabytes: string): number | null | undefined {
	const trimmed = gigabytes.trim();
	if (!trimmed) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) && value > 0 ? Math.round(value * GB) : undefined;
}

export function limitText(limit: number | null): string {
	if (!limit) return '';
	const value = limit / GB;
	return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '');
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function passwordProblem(password: string): string {
	if ([...password].length < 10) return 'Use at least 10 characters for the password.';
	if (password.length > 256) return 'Use at most 256 characters for the password.';
	if (password.startsWith('$') || password.startsWith('{')) return 'A password cannot start with $ or {.';
	return '';
}

export function personProblem(draft: PersonDraft, isNew: boolean): string {
	if (isNew) {
		if (!USERNAME.test(draft.name.trim().toLowerCase())) return 'The username can use letters, digits, dots, dashes and underscores.';
		if (!draft.domainId) return 'Choose a domain.';
		if (!draft.password) return 'Set a password.';
	}
	if (draft.password) {
		const problem = passwordProblem(draft.password);
		if (problem) return problem;
	}
	if (limitBytes(draft.limitGb) === undefined) return 'Enter the storage limit as a number of gigabytes, or leave it empty.';
	return '';
}

export function teamProblem(draft: TeamDraft): string {
	if (!USERNAME.test(draft.name.trim().toLowerCase())) return 'The team name can use letters, digits, dots, dashes and underscores.';
	if (!draft.domainId) return 'Choose a domain.';
	return '';
}

export function teamSet(teamIds: readonly string[]): Record<string, true> {
	return Object.fromEntries(teamIds.map((id) => [id, true as const]));
}

function rolesFor(role: PersonDraft['role']): Raw | undefined {
	return role === 'admin' ? { '@type': 'Admin' } : role === 'user' ? { '@type': 'User' } : undefined;
}

export function newPersonProperties(draft: PersonDraft): Raw {
	const limit = limitBytes(draft.limitGb);
	return {
		'@type': 'User',
		name: draft.name.trim().toLowerCase(),
		domainId: draft.domainId,
		...(draft.fullName.trim() ? { description: draft.fullName.trim() } : {}),
		credentials: { '0': { '@type': 'Password', secret: draft.password } },
		roles: rolesFor(draft.role) ?? { '@type': 'User' },
		quotas: limit ? { maxDiskQuota: limit } : {},
		memberGroupIds: teamSet(draft.teamIds)
	};
}

/** Only what changed, so anything this form does not show is left alone. */
export function personPatch(draft: PersonDraft, person: Person): Raw {
	const patch: Raw = {};
	if (draft.fullName.trim() !== person.fullName) patch.description = draft.fullName.trim() || null;
	const role = rolesFor(draft.role);
	if (role && draft.role !== person.role) patch.roles = role;
	const limit = limitBytes(draft.limitGb) ?? null;
	if (limit !== person.limit) patch.quotas = limit ? { maxDiskQuota: limit } : {};
	if ([...draft.teamIds].sort().join() !== [...person.teamIds].sort().join()) patch.memberGroupIds = teamSet(draft.teamIds);
	if (draft.password) {
		if (person.passwordKey !== null) patch[`credentials/${person.passwordKey}/secret`] = draft.password;
		else patch['credentials/0'] = { '@type': 'Password', secret: draft.password };
	}
	return patch;
}

export function draftFromPerson(person: Person): PersonDraft {
	return {
		name: person.name,
		domainId: person.domainId,
		fullName: person.fullName,
		password: '',
		role: person.role,
		limitGb: limitText(person.limit),
		teamIds: [...person.teamIds]
	};
}
