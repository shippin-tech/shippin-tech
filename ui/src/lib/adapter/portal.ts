import { accountId, idsOf, jmap, listOf } from './jmap';
import { registryGet, usingFor } from './portal-call';
import { authorization, clearSession } from './session';
import { registrySet, setResult, type RegistryChange } from './writes-call';
import type { PortalSchema } from '$lib/portal/schema';

export { cell, registryGet, rowCells, usingFor } from './portal-call';
const registryStates = new Map<string, string>();

export type RegistryListControls = {
	filterText: string;
	sortBy: string;
	sortAscending: boolean;
	limit: number;
	position: number;
};

export type RegistryListPage = {
	items: Record<string, unknown>[];
	controls: RegistryListControls;
	total: number | null;
	hasNext: boolean;
	hasPrev: boolean;
};

type RegistryListOptions = {
	filter?: Record<string, unknown>;
	filterText?: string;
	sortBy?: string;
	sortAscending?: boolean;
	limit?: number;
	position?: number;
	ids?: string[];
	properties?: string[];
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function sanitizeRegistryLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
	const raw = Number.isFinite(value) ? Number(value) : fallback;
	return Math.max(1, Math.min(MAX_LIMIT, Math.floor(raw)));
}

export function sanitizeRegistryPosition(value: number | undefined): number {
	const raw = Number.isFinite(value) ? Number(value) : 0;
	return Math.max(0, Math.floor(raw));
}

export function mergeRegistryFilter(filter: Record<string, unknown> | undefined, filterText: string): Record<string, unknown> | undefined {
	const merged = filter ? { ...filter } : {};
	const text = filterText.trim();
	if (text) merged.text = text;
	return Object.keys(merged).length ? merged : undefined;
}

export async function loadRegistry(
	objectName: string,
	filter?: Record<string, unknown>,
	ids?: string[]
): Promise<Record<string, unknown>[]> {
	const page = await loadRegistryPage(objectName, {
		filter,
		ids,
		limit: ids?.length || 500
	});
	return page.items;
}

export async function loadRegistryPage(objectName: string, options: RegistryListOptions = {}): Promise<RegistryListPage> {
	const id = accountId();
	const limit = sanitizeRegistryLimit(options.limit);
	const position = sanitizeRegistryPosition(options.position);
	const controls: RegistryListControls = {
		filterText: options.filterText?.trim() ?? '',
		sortBy: options.sortBy ?? '',
		sortAscending: options.sortAscending !== false,
		limit,
		position
	};
	const get = registryGet(objectName, id);
	if (options.properties) get[1].properties = options.properties;
	let queryIds: string[] | null = null;
	let total: number | null = null;

	if (options.ids?.length) {
		get[1].ids = options.ids;
	} else {
		const filter = mergeRegistryFilter(options.filter, controls.filterText);
		const query: Record<string, unknown> = { accountId: id, position: controls.position, limit: controls.limit };
		if (filter) query.filter = filter;
		if (controls.sortBy) query.sort = [{ property: controls.sortBy, isAscending: controls.sortAscending }];
		get[1]['#ids'] = { resultOf: 'q0', name: `${objectName}/query`, path: '/ids' };
		const responses = await jmap(usingFor(objectName), [[`${objectName}/query`, query, 'q0'], get]);
		const state = responses.find(([method]) => method === `${objectName}/get`)?.[1].state;
		if (typeof state === 'string') registryStates.set(`${id}:${objectName}`, state);
		queryIds = idsOf(responses, `${objectName}/query`);
		const queryPayload = responses.find(([method]) => method === `${objectName}/query`)?.[1];
		total = typeof queryPayload?.total === 'number' ? queryPayload.total : null;
		const rows = listOf<Record<string, unknown>>(responses, `${objectName}/get`);
		const byId = new Map(rows.map((row) => [String(row.id ?? ''), row]));
		const items = queryIds.map((entryId) => byId.get(entryId)).filter((row): row is Record<string, unknown> => Boolean(row));
		return {
			items,
			controls,
			total,
			hasPrev: controls.position > 0,
			hasNext: total == null ? queryIds.length === controls.limit : controls.position + queryIds.length < total
		};
	}

	const responses = await jmap(usingFor(objectName), [get]);
	const state = responses.find(([method]) => method === `${objectName}/get`)?.[1].state;
	if (typeof state === 'string') registryStates.set(`${id}:${objectName}`, state);
	const items = listOf<Record<string, unknown>>(responses, `${objectName}/get`);
	return {
		items,
		controls,
		total: items.length,
		hasPrev: false,
		hasNext: false
	};
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
