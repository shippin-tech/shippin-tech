import { paths } from './paths';

export const freeDiskQuota = 2 * 1024 * 1024 * 1024;

export type RegistryRow = {
	id: string;
	name: string;
	detail: string;
};

const using = ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'];

function authorization(username: string, password: string) {
	return 'Basic ' + btoa(`${username}:${password}`);
}

export async function registryGet(
	object: 'Tenant' | 'Domain' | 'Account',
	username: string,
	password: string
): Promise<RegistryRow[]> {
	const res = await fetch(paths.jmap, {
		method: 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			Authorization: authorization(username, password)
		},
		body: JSON.stringify({
			using,
			methodCalls: [[`x:${object}/get`, {}, 'c0']]
		})
	});
	const text = await res.text();
	if (!res.ok) throw new Error(text || 'http ' + res.status);
	const body = JSON.parse(text) as {
		methodResponses?: [string, { list?: Record<string, unknown>[]; type?: string; description?: string }, string][];
	};
	const reply = body.methodResponses?.[0]?.[1];
	if (!reply || !Array.isArray(reply.list)) {
		throw new Error(reply?.description || 'The engine returned no list.');
	}
	return reply.list.map((item, index) => ({
		id: String(item.id ?? index),
		name: String(item.name ?? ''),
		detail: JSON.stringify(item.quotas ?? item)
	}));
}

export async function scimProvider(username: string, password: string): Promise<string> {
	const res = await fetch(paths.scim + '/ServiceProviderConfig', {
		method: 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		headers: {
			Accept: 'application/scim+json, application/json',
			Authorization: authorization(username, password)
		}
	});
	const text = await res.text();
	if (!res.ok) throw new Error(text || 'http ' + res.status);
	return text;
}
