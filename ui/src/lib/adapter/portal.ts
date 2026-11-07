import { accountId, jmap, listOf } from './jmap';
import { registryGet, usingFor } from './portal-call';
import { authorization, clearSession } from './session';
import { registrySet, setResult, type RegistryChange } from './writes-call';
import type { PortalSchema } from '$lib/portal/schema';

export { cell, registryGet, rowCells, usingFor } from './portal-call';
const registryStates = new Map<string, string>();

export async function loadRegistry(objectName: string, filter?: Record<string, unknown>, ids?: string[]): Promise<Record<string, unknown>[]> {
	const get = registryGet(objectName, accountId());
	if (ids) get[1].ids = ids;
	const calls = [get];
	if (filter && Object.keys(filter).length) {
		get[1]['#ids'] = { resultOf: 'q0', name: `${objectName}/query`, path: '/ids' };
		calls.unshift([`${objectName}/query`, { accountId: accountId(), filter }, 'q0']);
	}
	const responses = await jmap(usingFor(objectName), calls);
	const state = responses.find(([method]) => method === `${objectName}/get`)?.[1].state;
	if (typeof state === 'string') registryStates.set(`${accountId()}:${objectName}`, state);
	return listOf<Record<string, unknown>>(responses, `${objectName}/get`);
}

export async function loadPortalSchema(): Promise<PortalSchema> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const response = await fetch('/api/schema', { headers: { Authorization: auth }, cache: 'no-store' });
	if (response.status === 401) { clearSession(); throw new Error('sign-in required'); }
	if (!response.ok) throw new Error('Could not load server schema: HTTP ' + response.status);
	return response.json();
}

export async function writeRegistry(object: string, change: RegistryChange, id: string): Promise<string> {
	const call = registrySet(object, accountId(), change);
	const state = registryStates.get(`${accountId()}:${object}`);
	if (state) call[1].ifInState = state;
	const responses = await jmap(usingFor(object), [call]);
	const payload = responses.find(([method]) => method === `${object}/set`)?.[1] ?? {};
	const result = setResult(payload, id);
	if (result === 'saved') {
		const created = payload.created as Record<string, { id?: string }> | undefined;
		return created?.[id]?.id ?? id;
	}
	const failure = [payload.notCreated, payload.notUpdated, payload.notDestroyed]
		.map((map) => map && typeof map === 'object' ? (map as Record<string, unknown>)[id] : null)
		.find(Boolean) as { description?: string; type?: string; properties?: unknown } | undefined;
	if (failure?.type === 'objectIsLinked') throw new Error('This record is still referenced by other objects. Remove those links before deleting it.');
	throw new Error((failure?.description || failure?.type || 'The server did not confirm the change.') + (Array.isArray(failure?.properties) ? ` (${failure.properties.join(', ')})` : ''));
}
