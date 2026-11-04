import { accountId, idsOf, jmap, listOf } from './jmap';

const CALENDARS = 'urn:ietf:params:jmap:calendars';
const CONTACTS = 'urn:ietf:params:jmap:contacts';
const FILES = 'urn:ietf:params:jmap:filenode';

export type Named = { id: string; name: string; detail: string };

type Row = { id?: string; title?: string | null; name?: unknown; start?: string | null };

function label(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		if (typeof record.full === 'string') return record.full;
		if (typeof record.name === 'string') return record.name;
	}
	return '';
}

function named(row: Row, titleKey: 'title' | 'name'): Named {
	const name = titleKey === 'title' ? row.title || 'Untitled' : label(row.name) || 'Untitled';
	return { id: String(row.id ?? ''), name, detail: row.start || '' };
}

async function queryGet(
	urn: string,
	query: string,
	get: string,
	properties: string[],
	titleKey: 'title' | 'name'
): Promise<Named[]> {
	const queried = await jmap(
		[urn],
		[[query, { accountId: accountId(), limit: 50 }, 'q0']]
	);
	const ids = idsOf(queried, query);
	if (!ids.length) return [];
	const fetched = await jmap(
		[urn],
		[[get, { accountId: accountId(), ids, properties }, 'g0']]
	);
	const byId = new Map(
		listOf<Row>(fetched, get).map((row) => [String(row.id), named(row, titleKey)])
	);
	return ids.map((id) => byId.get(id)).filter((row): row is Named => Boolean(row?.id));
}

export function loadEvents() {
	return queryGet(CALENDARS, 'CalendarEvent/query', 'CalendarEvent/get', ['id', 'title', 'start'], 'title');
}

export function loadContacts() {
	return queryGet(CONTACTS, 'ContactCard/query', 'ContactCard/get', ['id', 'name'], 'name');
}

export function loadFiles() {
	return queryGet(FILES, 'FileNode/query', 'FileNode/get', ['id', 'name'], 'name');
}
