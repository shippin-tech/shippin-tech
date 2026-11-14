import { jmap, listOf } from '../../adapter/jmap';
import { newPersonProperties, personPatch, sortPeople, teamSet, toPerson, toTeam, type Person, type PersonDraft, type Team, type TeamDomain, type TeamDraft } from './team-call';

export * from './team-call';

const ADMIN = 'urn:shippin.tech:jmap';

type SetPayload = {
	created?: Record<string, { id?: string }>;
	notCreated?: Record<string, { description?: unknown; type?: unknown }>;
	updated?: Record<string, unknown>;
	notUpdated?: Record<string, { description?: unknown; type?: unknown }>;
	destroyed?: string[];
	notDestroyed?: Record<string, { description?: unknown; type?: unknown }>;
};

function reason(error: { description?: unknown; type?: unknown } | undefined, fallback: string): string {
	if (error?.type === 'primaryKeyViolation') return 'That name is already taken.';
	return typeof error?.description === 'string' && error.description ? error.description : fallback;
}

async function setAccounts(args: Record<string, unknown>): Promise<SetPayload> {
	const responses = await jmap([ADMIN], [['x:Account/set', args, 's']]);
	return (responses[0]?.[1] ?? {}) as SetPayload;
}

export async function loadDirectory(): Promise<{ people: Person[]; teams: Team[]; domains: TeamDomain[] }> {
	const responses = await jmap(
		[ADMIN],
		[
			['x:Account/query', {}, 'a'],
			['x:Account/get', { '#ids': { resultOf: 'a', name: 'x:Account/query', path: '/ids' } }, 'b'],
			['x:Domain/query', {}, 'c'],
			['x:Domain/get', { '#ids': { resultOf: 'c', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'd']
		]
	);
	const accounts = listOf<Record<string, unknown>>(responses, 'x:Account/get');
	return {
		people: sortPeople(accounts.flatMap((raw) => toPerson(raw) ?? [])),
		teams: accounts.flatMap((raw) => toTeam(raw) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
		domains: listOf<{ id?: unknown; name?: unknown }>(responses, 'x:Domain/get')
			.map((row) => ({ id: String(row.id), name: String(row.name) }))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}

export async function createPerson(draft: PersonDraft): Promise<void> {
	const payload = await setAccounts({ create: { p: newPersonProperties(draft) } });
	if (!payload.created?.p?.id) throw new Error(reason(payload.notCreated?.p, 'The person could not be added.'));
}

export async function updatePerson(person: Person, draft: PersonDraft): Promise<boolean> {
	const patch = personPatch(draft, person);
	if (Object.keys(patch).length === 0) return false;
	const payload = await setAccounts({ update: { [person.id]: patch } });
	if (!payload.updated || !(person.id in payload.updated)) throw new Error(reason(payload.notUpdated?.[person.id], 'The changes could not be saved.'));
	return true;
}

export async function removeAccount(id: string): Promise<void> {
	const payload = await setAccounts({ destroy: [id] });
	if (!payload.destroyed?.includes(id)) throw new Error(reason(payload.notDestroyed?.[id], 'It could not be removed.'));
}

export async function createTeam(draft: TeamDraft): Promise<void> {
	const payload = await setAccounts({
		create: { t: { '@type': 'Group', name: draft.name.trim().toLowerCase(), domainId: draft.domainId, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) } }
	});
	if (!payload.created?.t?.id) throw new Error(reason(payload.notCreated?.t, 'The team could not be created.'));
}

/** Adds or removes one person from one team. */
export async function setMembership(person: Person, teamId: string, member: boolean): Promise<void> {
	const teamIds = member ? [...new Set([...person.teamIds, teamId])] : person.teamIds.filter((id) => id !== teamId);
	const payload = await setAccounts({ update: { [person.id]: { memberGroupIds: teamSet(teamIds) } } });
	if (!payload.updated || !(person.id in payload.updated)) throw new Error(reason(payload.notUpdated?.[person.id], 'The team could not be changed.'));
}
