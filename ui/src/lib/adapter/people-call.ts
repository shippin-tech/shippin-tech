/**
 * Pure helpers for Contacts. The server side is JMAP AddressBook and ContactCard
 * (crates/jmap/src/addressbook, crates/jmap/src/contact); the calls live in
 * adapter/people.ts.
 */

export type AddressBook = { id: string; name: string; isDefault: boolean; canWrite: boolean; canDelete: boolean };

export type Person = {
	id: string;
	addressBookIds: string[];
	given: string;
	surname: string;
	displayName: string;
	emails: string[];
	phones: string[];
	organization: string;
	jobTitle: string;
	notes: string;
};

export type PersonDraft = {
	addressBookId: string;
	given: string;
	surname: string;
	emails: string[];
	phones: string[];
	organization: string;
	jobTitle: string;
	notes: string;
};

type Raw = Record<string, unknown>;

function values(map: unknown): Raw[] {
	return map && typeof map === 'object' ? (Object.values(map) as Raw[]).filter((item) => item && typeof item === 'object') : [];
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function toPerson(raw: Raw): Person | null {
	if (typeof raw.id !== 'string') return null;
	const name = raw.name && typeof raw.name === 'object' ? (raw.name as Raw) : {};
	const components = Array.isArray(name.components) ? (name.components as Raw[]) : [];
	const part = (kind: string) => text(components.find((item) => item?.kind === kind)?.value);
	const given = part('given');
	const surname = part('surname');
	const emails = values(raw.emails).map((item) => text(item.address)).filter(Boolean);
	const phones = values(raw.phones).map((item) => text(item.number)).filter(Boolean);
	const organization = text(values(raw.organizations)[0]?.name);
	const displayName = text(name.full) || [given, surname].filter(Boolean).join(' ') || organization || emails[0] || 'No name';
	return {
		id: raw.id,
		addressBookIds: raw.addressBookIds && typeof raw.addressBookIds === 'object' ? Object.keys(raw.addressBookIds) : [],
		given,
		surname,
		displayName,
		emails,
		phones,
		organization,
		jobTitle: text(values(raw.titles)[0]?.name),
		notes: text(values(raw.notes)[0]?.note)
	};
}

/** By surname, then given name, ignoring case and accents. */
export function sortPeople(people: readonly Person[]): Person[] {
	const key = (person: Person) => `${person.surname || person.displayName} ${person.given}`;
	return [...people].sort((a, b) => key(a).localeCompare(key(b), undefined, { sensitivity: 'base' }));
}

export function searchPeople(people: readonly Person[], query: string): Person[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [...people];
	return people.filter((person) => {
		const haystack = [person.displayName, person.organization, person.jobTitle, ...person.emails, ...person.phones].join(' ').toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}

export function emptyPersonDraft(addressBookId: string): PersonDraft {
	return { addressBookId, given: '', surname: '', emails: [''], phones: [''], organization: '', jobTitle: '', notes: '' };
}

export function draftFromPerson(person: Person): PersonDraft {
	return {
		addressBookId: person.addressBookIds[0] ?? '',
		given: person.given,
		surname: person.surname,
		emails: person.emails.length ? [...person.emails] : [''],
		phones: person.phones.length ? [...person.phones] : [''],
		organization: person.organization,
		jobTitle: person.jobTitle,
		notes: person.notes
	};
}

const filled = (items: readonly string[]) => items.map((item) => item.trim()).filter(Boolean);

export function personProblem(draft: PersonDraft): string {
	if (!draft.addressBookId) return 'Choose an address book.';
	if (!draft.given.trim() && !draft.surname.trim() && !draft.organization.trim() && !filled(draft.emails).length) {
		return 'Add a name, a company or an email address.';
	}
	const bad = filled(draft.emails).find((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
	return bad ? `${bad} is not an email address.` : '';
}

function keyed(items: readonly string[], prefix: string, build: (item: string) => Raw): Raw | null {
	if (!items.length) return null;
	return Object.fromEntries(items.map((item, index) => [`${prefix}${index}`, build(item)]));
}

/** The properties to store. Anything this form does not cover is left alone on an update. */
export function personProperties(draft: PersonDraft, isNew: boolean): Raw {
	const given = draft.given.trim();
	const surname = draft.surname.trim();
	const components = [
		...(given ? [{ '@type': 'NameComponent', kind: 'given', value: given }] : []),
		...(surname ? [{ '@type': 'NameComponent', kind: 'surname', value: surname }] : [])
	];
	const properties: Raw = {
		addressBookIds: { [draft.addressBookId]: true },
		name: components.length ? { '@type': 'Name', components, isOrdered: true } : null,
		emails: keyed(filled(draft.emails), 'e', (address) => ({ '@type': 'EmailAddress', address })),
		phones: keyed(filled(draft.phones), 'p', (number) => ({ '@type': 'Phone', number })),
		organizations: draft.organization.trim() ? { o: { '@type': 'Organization', name: draft.organization.trim() } } : null,
		titles: draft.jobTitle.trim() ? { t: { '@type': 'Title', name: draft.jobTitle.trim() } } : null,
		notes: draft.notes.trim() ? { n: { '@type': 'Note', note: draft.notes.trim() } } : null
	};
	if (isNew) {
		properties['@type'] = 'Card';
		properties.version = '1.0';
		properties.kind = 'individual';
		for (const key of Object.keys(properties)) if (properties[key] === null) delete properties[key];
	}
	return properties;
}

export function initials(person: Person): string {
	const letters = [person.given, person.surname].filter(Boolean).map((word) => word[0]);
	return (letters.length ? letters.join('') : person.displayName.slice(0, 1)).toUpperCase();
}
