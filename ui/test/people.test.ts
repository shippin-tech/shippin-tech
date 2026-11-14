import { describe, expect, it } from 'vitest';
import {
	draftFromPerson,
	emptyPersonDraft,
	initials,
	personProblem,
	personProperties,
	searchPeople,
	sortPeople,
	toPerson,
	type Person
} from '../src/lib/adapter/people-call';

function person(overrides: Partial<Person> = {}): Person {
	return { id: '1', addressBookIds: ['b'], given: 'Ada', surname: 'Lovelace', displayName: 'Ada Lovelace', emails: ['ada@example.org'], phones: [], organization: 'Analytical', jobTitle: '', notes: '', ...overrides };
}

describe('contact helpers', () => {
	it('reads server cards', () => {
		const parsed = toPerson({
			id: 'c',
			addressBookIds: { b: true },
			name: { full: 'Ada Lovelace', components: [{ kind: 'given', value: 'Ada' }, { kind: 'surname', value: 'Lovelace' }] },
			emails: { e: { address: 'ada@example.org' } },
			phones: { p: { number: '+1 555 0100' } },
			organizations: { o: { name: 'Analytical' } },
			titles: { t: { name: 'Countess' } },
			notes: { n: { note: 'Hello' } }
		})!;
		expect(parsed).toEqual({
			id: 'c', addressBookIds: ['b'], given: 'Ada', surname: 'Lovelace', displayName: 'Ada Lovelace',
			emails: ['ada@example.org'], phones: ['+1 555 0100'], organization: 'Analytical', jobTitle: 'Countess', notes: 'Hello'
		});
		expect(toPerson({ id: 'x', organizations: { o: { name: 'Acme' } } })?.displayName).toBe('Acme');
		expect(toPerson({ id: 'x', emails: { e: { address: 'a@b.c' } } })?.displayName).toBe('a@b.c');
		expect(toPerson({ id: 'x' })?.displayName).toBe('No name');
		expect(toPerson({})).toBeNull();
	});

	it('sorts by surname and finds people by any detail', () => {
		const people = [person({ id: '2', given: 'Grace', surname: 'Hopper', displayName: 'Grace Hopper', emails: ['grace@navy.mil'], organization: 'Navy' }), person()];
		expect(sortPeople(people).map((item) => item.surname)).toEqual(['Hopper', 'Lovelace']);
		expect(searchPeople(people, 'ada').map((item) => item.id)).toEqual(['1']);
		expect(searchPeople(people, 'NAVY grace').map((item) => item.id)).toEqual(['2']);
		expect(searchPeople(people, 'nobody')).toEqual([]);
		expect(searchPeople(people, '  ')).toHaveLength(2);
	});

	it('checks the form', () => {
		const empty = emptyPersonDraft('b');
		expect(personProblem(empty)).toContain('name');
		expect(personProblem({ ...empty, given: 'Ada' })).toBe('');
		expect(personProblem({ ...empty, organization: 'Acme' })).toBe('');
		expect(personProblem({ ...empty, emails: ['nope'] })).toContain('not an email');
		expect(personProblem({ ...empty, given: 'Ada', addressBookId: '' })).toContain('address book');
	});

	it('builds what the server stores', () => {
		const created = personProperties({ ...emptyPersonDraft('b'), given: ' Ada ', emails: ['a@b.co', ' '], phones: [''] }, true);
		expect(created).toEqual({
			'@type': 'Card',
			version: '1.0',
			kind: 'individual',
			addressBookIds: { b: true },
			name: { '@type': 'Name', components: [{ '@type': 'NameComponent', kind: 'given', value: 'Ada' }], isOrdered: true },
			emails: { e0: { '@type': 'EmailAddress', address: 'a@b.co' } }
		});
		const updated = personProperties({ ...emptyPersonDraft('b'), organization: 'Acme' }, false);
		expect(updated.name).toBeNull();
		expect(updated.emails).toBeNull();
		expect('@type' in updated).toBe(false);
	});

	it('round-trips a person through the form', () => {
		expect(draftFromPerson(person())).toMatchObject({ addressBookId: 'b', given: 'Ada', emails: ['ada@example.org'], phones: [''] });
		expect(initials(person())).toBe('AL');
		expect(initials(person({ given: '', surname: '', displayName: 'acme' }))).toBe('A');
	});
});
