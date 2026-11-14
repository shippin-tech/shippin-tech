/** Pure helpers for organisations; the calls are in orgs.ts. */

import type { DnsCheck } from '$lib/panel/model';

export type OrgDomain = { id: string; name: string };

export type Organisation = {
	id: string;
	name: string;
	domains: string[];
	admins: string[];
	maxPeople: number;
	maxStorage: number;
	createdAt: number;
	people: number;
	storageHeld: number;
};

export type OrgDraft = { id: string; name: string; domains: string[]; admins: string; maxPeople: string; maxStorageGb: string };

export type OrgPerson = {
	id: string;
	name: string;
	email: string;
	domainId: string;
	fullName: string;
	limit: number | null;
	used: number;
	aliases: string[];
	teamIds: string[];
	admin: boolean;
	protected: boolean;
};

export type OrgTeam = { id: string; name: string; email: string; domainId: string; description: string };

export type OrgDns = { domain: string; zone: string; records: DnsCheck[] };

export type MyOrg = {
	name: string;
	maxPeople: number;
	maxStorage: number;
	storageHeld: number;
	storageUsed: number;
	domains: OrgDomain[];
	people: OrgPerson[];
	teams: OrgTeam[];
	me: string;
};

export type OrgPersonDraft = { name: string; domainId: string; fullName: string; password: string; limitGb: string };

const GB = 1024 ** 3;

export function emptyOrgDraft(): OrgDraft {
	return { id: '', name: '', domains: [], admins: '', maxPeople: '25', maxStorageGb: '0' };
}

export function draftFromOrg(org: Organisation): OrgDraft {
	return {
		id: org.id,
		name: org.name,
		domains: [...org.domains],
		admins: org.admins.join(', '),
		maxPeople: String(org.maxPeople),
		maxStorageGb: String(Math.round(org.maxStorage / GB))
	};
}

export function orgAddresses(text: string): string[] {
	return text
		.split(/[\s,;]+/)
		.map((address) => address.trim())
		.filter(Boolean);
}

export function orgProblem(draft: OrgDraft): string {
	if (!draft.name.trim()) return 'Give the organisation a name.';
	if (draft.domains.length === 0) return 'Choose at least one domain.';
	if (orgAddresses(draft.admins).length === 0) return 'Name at least one administrator.';
	const people = Number(draft.maxPeople);
	if (!Number.isInteger(people) || people < 1 || people > 100000) return 'Allow between 1 and 100,000 people.';
	const storage = Number(draft.maxStorageGb);
	if (!Number.isInteger(storage) || storage < 0) return 'Storage is a whole number of gigabytes, or 0 for no limit.';
	return '';
}

export function orgPayload(draft: OrgDraft) {
	return {
		id: draft.id,
		name: draft.name.trim(),
		domains: draft.domains,
		admins: orgAddresses(draft.admins),
		maxPeople: Number(draft.maxPeople),
		maxStorageGb: Number(draft.maxStorageGb)
	};
}

export function storageText(bytes: number): string {
	const gb = bytes / GB;
	return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

export function storageUse(held: number, max: number): string {
	return max === 0 ? `${storageText(held)} set aside, no overall limit` : `${storageText(held)} of ${storageText(max)} set aside`;
}

export function peopleUse(count: number, max: number): string {
	return `${count} of ${max} people`;
}

export function emptyOrgPersonDraft(domainId = ''): OrgPersonDraft {
	return { name: '', domainId, fullName: '', password: '', limitGb: '' };
}

export function orgPersonProblem(draft: OrgPersonDraft, needsLimit: boolean): string {
	if (!draft.name.trim()) return 'Enter the part of the address before the @.';
	if (!draft.domainId) return 'Choose a domain.';
	if (draft.password.length === 0) return 'Set a password.';
	const limit = limitProblem(draft.limitGb, needsLimit);
	return limit;
}

export function limitProblem(limitGb: string, needsLimit: boolean): string {
	if (limitGb.trim() === '') return needsLimit ? 'Your organisation shares its storage, so set a limit for this person.' : '';
	const value = Number(limitGb);
	return Number.isFinite(value) && value > 0 ? '' : 'Storage must be more than zero.';
}

export function orgPersonPayload(draft: OrgPersonDraft) {
	return {
		name: draft.name.trim(),
		domainId: draft.domainId,
		fullName: draft.fullName.trim(),
		password: draft.password,
		...(draft.limitGb.trim() === '' ? {} : { limitGb: Number(draft.limitGb) })
	};
}
