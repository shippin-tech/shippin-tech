import { describe, expect, it } from 'vitest';
import {
	displayName,
	draftFromPerson,
	filterPeople,
	limitBytes,
	limitText,
	membersOf,
	newPersonProperties,
	passwordProblem,
	personPatch,
	personProblem,
	sortPeople,
	teamProblem,
	toPerson,
	toTeam,
	type Person,
	type PersonDraft
} from '../src/lib/shippin/people/team-call';

const GB = 1024 ** 3;

function person(overrides: Partial<Person> = {}): Person {
	return { id: 'p', name: 'ada', domainId: 'd', email: 'ada@x.test', fullName: 'Ada Lovelace', role: 'user', used: 10, limit: 2 * GB, teamIds: ['t1'], passwordKey: '0', createdAt: '', ...overrides };
}

function draft(overrides: Partial<PersonDraft> = {}): PersonDraft {
	return { name: 'ada', domainId: 'd', fullName: 'Ada', password: 'long enough secret', role: 'user', limitGb: '', teamIds: [], ...overrides };
}

describe('people and teams helpers', () => {
	it('reads accounts', () => {
		const parsed = toPerson({
			id: 'p',
			'@type': 'User',
			name: 'ada',
			domainId: 'd',
			emailAddress: 'ada@x.test',
			description: 'Ada',
			roles: { '@type': 'Admin' },
			usedDiskQuota: 5,
			quotas: { maxDiskQuota: GB },
			memberGroupIds: { t1: true },
			credentials: { '3': { '@type': 'AppPassword' }, '4': { '@type': 'Password' } }
		});
		expect(parsed).toMatchObject({ role: 'admin', used: 5, limit: GB, teamIds: ['t1'], passwordKey: '4' });
		expect(toPerson({ id: 'g', '@type': 'Group' })).toBeNull();
		expect(toPerson({ id: 'p', '@type': 'User', quotas: {} })?.limit).toBeNull();
		expect(toPerson({ id: 'p', '@type': 'User', roles: { '@type': 'Custom' } })?.role).toBe('custom');
		expect(toTeam({ id: 't', '@type': 'Group', name: 'sales', emailAddress: 'sales@x.test' })).toMatchObject({ name: 'sales', email: 'sales@x.test' });
		expect(toTeam({ id: 'p', '@type': 'User' })).toBeNull();
	});

	it('sorts and finds people', () => {
		const grace = person({ id: 'g', fullName: 'Grace Hopper', email: 'grace@x.test', teamIds: [] });
		expect(sortPeople([grace, person()]).map((item) => item.id)).toEqual(['p', 'g']);
		expect(filterPeople([grace, person()], 'grace').map((item) => item.id)).toEqual(['g']);
		expect(filterPeople([grace, person()], '', 't1').map((item) => item.id)).toEqual(['p']);
		expect(membersOf([grace, person()], 't1').map((item) => item.id)).toEqual(['p']);
		expect(displayName(person({ fullName: '' }))).toBe('ada@x.test');
	});

	it('reads storage limits', () => {
		expect(limitBytes('')).toBeNull();
		expect(limitBytes('2')).toBe(2 * GB);
		expect(limitBytes('0.5')).toBe(GB / 2);
		expect(limitBytes('lots')).toBeUndefined();
		expect(limitBytes('-1')).toBeUndefined();
		expect(limitText(2 * GB)).toBe('2');
		expect(limitText(null)).toBe('');
	});

	it('checks forms', () => {
		expect(personProblem(draft(), true)).toBe('');
		expect(personProblem(draft({ name: 'has space' }), true)).toContain('username');
		expect(personProblem(draft({ domainId: '' }), true)).toContain('domain');
		expect(personProblem(draft({ password: '' }), true)).toContain('password');
		expect(personProblem(draft({ password: '' }), false)).toBe('');
		expect(personProblem(draft({ limitGb: 'x' }), false)).toContain('gigabytes');
		expect(passwordProblem('short')).toContain('10');
		expect(passwordProblem('$argon2id$longenough')).toContain('$');
		expect(teamProblem({ name: 'sales team', domainId: 'd', description: '' })).toContain('team name');
		expect(teamProblem({ name: 'sales', domainId: 'd', description: '' })).toBe('');
	});

	it('builds a new account', () => {
		expect(newPersonProperties(draft({ name: ' ADA ', limitGb: '1', teamIds: ['t1'], role: 'admin' }))).toEqual({
			'@type': 'User',
			name: 'ada',
			domainId: 'd',
			description: 'Ada',
			credentials: { '0': { '@type': 'Password', secret: 'long enough secret' } },
			roles: { '@type': 'Admin' },
			quotas: { maxDiskQuota: GB },
			memberGroupIds: { t1: true }
		});
	});

	it('sends only what changed', () => {
		const current = person();
		expect(personPatch(draftFromPerson(current), current)).toEqual({});
		expect(personPatch({ ...draftFromPerson(current), limitGb: '' }, current)).toEqual({ quotas: {} });
		expect(personPatch({ ...draftFromPerson(current), limitGb: '3' }, current)).toEqual({ quotas: { maxDiskQuota: 3 * GB } });
		expect(personPatch({ ...draftFromPerson(current), role: 'admin' }, current)).toEqual({ roles: { '@type': 'Admin' } });
		expect(personPatch({ ...draftFromPerson(current), teamIds: [] }, current)).toEqual({ memberGroupIds: {} });
		expect(personPatch({ ...draftFromPerson(current), password: 'new long password' }, current)).toEqual({ 'credentials/0/secret': 'new long password' });
		const custom = person({ role: 'custom' });
		expect(personPatch(draftFromPerson(custom), custom)).toEqual({});
	});
});
