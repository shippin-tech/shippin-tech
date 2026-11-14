import { authorization } from '../../adapter/session';
import { orgPayload, orgPersonPayload, type MyOrg, type OrgDns, type OrgDomain, type OrgDraft, type OrgPersonDraft, type Organisation } from './orgs-call';

export * from './orgs-call';

async function call<T>(method: string, path: string, fallback: string, body?: unknown): Promise<T> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch(`/api/${path}`, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const reply = (await res.json().catch(() => null)) as (T & { message?: string; detail?: string }) | null;
	if (!res.ok || reply === null) throw new Error(reply?.message ?? reply?.detail ?? fallback);
	return reply;
}

export function loadOrgs(): Promise<{ orgs: Organisation[]; domains: OrgDomain[] }> {
	return call('GET', 'orgs', 'Organisations could not be loaded.');
}

export function saveOrg(draft: OrgDraft): Promise<Organisation> {
	return call('POST', 'orgs', 'The organisation could not be saved.', orgPayload(draft));
}

export function removeOrg(id: string): Promise<unknown> {
	return call('DELETE', `orgs/${encodeURIComponent(id)}`, 'The organisation could not be removed.');
}

export function loadMyOrg(): Promise<MyOrg> {
	return call('GET', 'org', 'Your organisation could not be loaded.');
}

export function addOrgPerson(draft: OrgPersonDraft): Promise<unknown> {
	return call('POST', 'org/people', 'The person could not be added.', orgPersonPayload(draft));
}

export function updateOrgPerson(id: string, change: { password?: string; limitGb?: number; fullName?: string }): Promise<unknown> {
	return call('POST', `org/people/${encodeURIComponent(id)}`, 'The changes could not be saved.', change);
}

export function removeOrgPerson(id: string): Promise<unknown> {
	return call('DELETE', `org/people/${encodeURIComponent(id)}`, 'The person could not be removed.');
}

export function createOrgTeam(draft: { name: string; domainId: string; description: string }): Promise<unknown> {
	return call('POST', 'org/teams', 'The team could not be made.', draft);
}

export function removeOrgTeam(id: string): Promise<unknown> {
	return call('DELETE', `org/teams/${encodeURIComponent(id)}`, 'The team could not be removed.');
}

export function setOrgTeamMember(teamId: string, person: string, member: boolean): Promise<unknown> {
	return call('POST', `org/teams/${encodeURIComponent(teamId)}/members`, 'The team could not be changed.', { person, member });
}

export function addOrgAlias(personId: string, alias: string): Promise<unknown> {
	return call('POST', `org/people/${encodeURIComponent(personId)}/aliases`, 'The address could not be added.', { alias });
}

export function removeOrgAlias(personId: string, alias: string): Promise<unknown> {
	return call('DELETE', `org/people/${encodeURIComponent(personId)}/aliases/${encodeURIComponent(alias)}`, 'The address could not be removed.');
}

export function loadOrgDns(domainId: string): Promise<OrgDns> {
	return call('GET', `org/domains/${encodeURIComponent(domainId)}/dns`, 'DNS could not be checked.');
}
