import { paths } from './paths';
import { account, authorization, clearSession } from './session';

export type MethodCall = [string, Record<string, unknown>, string];
export type MethodResponse = [string, Record<string, unknown>, string];

const CORE = 'urn:ietf:params:jmap:core';

export async function jmap(using: string[], calls: MethodCall[]): Promise<MethodResponse[]> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch(paths.jmap, {
		method: 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({ using: [CORE, ...using.filter((urn) => urn !== CORE)], methodCalls: calls })
	});
	if (res.status === 401) {
		clearSession();
		throw new Error('sign-in required');
	}
	if (!res.ok) throw new Error('http ' + res.status);
	const body = (await res.json()) as { methodResponses?: MethodResponse[] };
	const responses = body.methodResponses ?? [];
	for (const [name, payload] of responses) {
		if (name === 'error') {
			const detail = payload.description ?? payload.type ?? 'jmap error';
			throw new Error(String(detail));
		}
	}
	return responses;
}

export function accountId(): string {
	const id = account()?.accountId;
	if (!id) throw new Error('sign-in required');
	return id;
}

export function listOf<T>(responses: MethodResponse[], name: string): T[] {
	const match = responses.find((response) => response[0] === name);
	const list = match?.[1]?.list;
	return Array.isArray(list) ? (list as T[]) : [];
}

export function idsOf(responses: MethodResponse[], name: string): string[] {
	const match = responses.find((response) => response[0] === name);
	const ids = match?.[1]?.ids;
	return Array.isArray(ids) ? ids.map(String) : [];
}
