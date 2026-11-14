import { describe, expect, it } from 'vitest';
import { draftFromOrg, emptyOrgDraft, emptyOrgPersonDraft, limitProblem, orgAddresses, orgPayload, orgPersonPayload, orgPersonProblem, orgProblem, peopleUse, storageUse, type Organisation } from '../src/lib/shippin/org/orgs-call';
import { homeFor, navFor } from '../src/lib/adapter/home';

const GB = 1024 ** 3;

const good = { ...emptyOrgDraft(), name: 'Hill Farm', domains: ['d1'], admins: 'ada@hill.test' };

describe('organisation helpers', () => {
	it('explains what is wrong with an organisation', () => {
		expect(orgProblem(good)).toBe('');
		expect(orgProblem({ ...good, name: ' ' })).toMatch(/name/);
		expect(orgProblem({ ...good, domains: [] })).toMatch(/domain/);
		expect(orgProblem({ ...good, admins: ' , ' })).toMatch(/administrator/);
		expect(orgProblem({ ...good, maxPeople: '0' })).toMatch(/people/);
		expect(orgProblem({ ...good, maxStorageGb: '1.5' })).toMatch(/whole number/);
	});

	it('round-trips an organisation through its form', () => {
		const org: Organisation = { id: 'o', name: 'Hill Farm', domains: ['d1'], admins: ['a@b.co', 'c@d.co'], maxPeople: 9, maxStorage: 3 * GB, createdAt: 1, people: 2, storageHeld: GB };
		const draft = draftFromOrg(org);
		expect(draft).toMatchObject({ admins: 'a@b.co, c@d.co', maxPeople: '9', maxStorageGb: '3' });
		expect(orgPayload(draft)).toMatchObject({ id: 'o', admins: ['a@b.co', 'c@d.co'], maxPeople: 9, maxStorageGb: 3 });
		expect(orgAddresses('a@b.co;c@d.co\ne@f.co')).toHaveLength(3);
	});

	it('says how much is used', () => {
		expect(peopleUse(2, 5)).toBe('2 of 5 people');
		expect(storageUse(GB, 4 * GB)).toBe('1 GB of 4 GB set aside');
		expect(storageUse(GB * 1.5, 0)).toBe('1.5 GB set aside, no overall limit');
	});

	it('needs a limit for each person when storage is shared', () => {
		const draft = { ...emptyOrgPersonDraft('d1'), name: 'ada', password: 'secret' };
		expect(orgPersonProblem(draft, false)).toBe('');
		expect(orgPersonProblem(draft, true)).toMatch(/set a limit/);
		expect(orgPersonProblem({ ...draft, limitGb: '2' }, true)).toBe('');
		expect(limitProblem('0', false)).toMatch(/more than zero/);
		expect(orgPersonProblem({ ...draft, name: ' ' }, false)).toMatch(/before the @/);
		expect(orgPersonProblem({ ...draft, password: '' }, false)).toMatch(/password/);
	});

	it('leaves out storage nobody set', () => {
		expect(orgPersonPayload({ ...emptyOrgPersonDraft('d1'), name: ' ada ', password: 'x' })).toEqual({ name: 'ada', domainId: 'd1', fullName: '', password: 'x' });
		expect(orgPersonPayload({ ...emptyOrgPersonDraft('d1'), name: 'a', password: 'x', limitGb: '2' }).limitGb).toBe(2);
	});

	it('sends organisation administrators to their organisation', () => {
		expect(homeFor('org')).toBe('/shippin/org');
		expect(navFor('org', true)[0]).toEqual({ href: '/shippin/org', label: 'Organisation' });
		expect(navFor('org', true).map((item) => item.href)).not.toContain('/shippin/admin');
	});
});
