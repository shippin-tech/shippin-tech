import { accountId, jmap, listOf, type MethodResponse } from './jmap';
import { personProperties, sortPeople, toPerson, type AddressBook, type Person, type PersonDraft } from './people-call';

export * from './people-call';

const CONTACTS = 'urn:ietf:params:jmap:contacts';

type SetPayload = {
	created?: Record<string, { id?: string }>;
	notCreated?: Record<string, { description?: unknown }>;
	updated?: Record<string, unknown>;
	notUpdated?: Record<string, { description?: unknown }>;
	destroyed?: string[];
	notDestroyed?: Record<string, { description?: unknown }>;
};

function setPayload(responses: MethodResponse[], method: string): SetPayload {
	return (responses.find((response) => response[0] === method)?.[1] ?? {}) as SetPayload;
}

function reason(error: { description?: unknown } | undefined, fallback: string): string {
	return typeof error?.description === 'string' && error.description ? error.description : fallback;
}

export async function listAddressBooks(): Promise<AddressBook[]> {
	const responses = await jmap([CONTACTS], [['AddressBook/get', { accountId: accountId() }, 'b']]);
	return listOf<{ id?: unknown; name?: unknown; isDefault?: unknown; myRights?: Record<string, unknown> }>(responses, 'AddressBook/get')
		.flatMap((row) =>
			typeof row.id === 'string'
				? [
						{
							id: row.id,
							name: String(row.name ?? 'Address book'),
							isDefault: row.isDefault === true,
							canWrite: row.myRights?.mayWrite === true,
							canDelete: row.myRights?.mayDelete === true && row.isDefault !== true
						}
					]
				: []
		)
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export async function listPeople(): Promise<Person[]> {
	const id = accountId();
	const responses = await jmap(
		[CONTACTS],
		[
			['ContactCard/query', { accountId: id }, 'q'],
			['ContactCard/get', { accountId: id, '#ids': { resultOf: 'q', name: 'ContactCard/query', path: '/ids' } }, 'g']
		]
	);
	return sortPeople(listOf<Record<string, unknown>>(responses, 'ContactCard/get').flatMap((raw) => toPerson(raw) ?? []));
}

export async function savePerson(draft: PersonDraft, original?: Person): Promise<void> {
	const properties = personProperties(draft, !original);
	const args = original ? { update: { [original.id]: properties } } : { create: { c: properties } };
	const payload = setPayload(await jmap([CONTACTS], [['ContactCard/set', { accountId: accountId(), ...args }, 's']]), 'ContactCard/set');
	if (original) {
		if (!payload.updated || !(original.id in payload.updated)) throw new Error(reason(payload.notUpdated?.[original.id], 'The contact could not be saved.'));
	} else if (!payload.created?.c?.id) {
		throw new Error(reason(payload.notCreated?.c, 'The contact could not be created.'));
	}
}

export async function deletePerson(id: string): Promise<void> {
	const payload = setPayload(await jmap([CONTACTS], [['ContactCard/set', { accountId: accountId(), destroy: [id] }, 's']]), 'ContactCard/set');
	if (!payload.destroyed?.includes(id)) throw new Error(reason(payload.notDestroyed?.[id], 'The contact could not be deleted.'));
}

export async function createAddressBook(name: string): Promise<void> {
	const payload = setPayload(
		await jmap([CONTACTS], [['AddressBook/set', { accountId: accountId(), create: { b: { name: name.trim() } } }, 's']]),
		'AddressBook/set'
	);
	if (!payload.created?.b?.id) throw new Error(reason(payload.notCreated?.b, 'The address book could not be created.'));
}

export async function deleteAddressBook(id: string): Promise<void> {
	const payload = setPayload(
		await jmap([CONTACTS], [['AddressBook/set', { accountId: accountId(), destroy: [id], onDestroyRemoveContents: true }, 's']]),
		'AddressBook/set'
	);
	if (!payload.destroyed?.includes(id)) throw new Error(reason(payload.notDestroyed?.[id], 'The address book could not be deleted.'));
}
