import type { MethodCall } from './jmap';

const MAIL = 'urn:ietf:params:jmap:mail';
const SUBMISSION = 'urn:ietf:params:jmap:submission';
const VACATION = 'urn:ietf:params:jmap:vacationresponse';
const CONTACTS = 'urn:ietf:params:jmap:contacts';
const CALENDARS = 'urn:ietf:params:jmap:calendars';
const SIEVE = 'urn:ietf:params:jmap:sieve';
const FILE_NODE = 'urn:ietf:params:jmap:filenode';
const PRINCIPALS = 'urn:ietf:params:jmap:principals';
const QUOTA = 'urn:ietf:params:jmap:quota';

const STANDARD: Record<string, string> = {
	Mailbox: MAIL,
	Thread: MAIL,
	Email: MAIL,
	Identity: SUBMISSION,
	EmailSubmission: SUBMISSION,
	VacationResponse: VACATION,
	AddressBook: CONTACTS,
	ContactCard: CONTACTS,
	Calendar: CALENDARS,
	CalendarEvent: CALENDARS,
	SieveScript: SIEVE,
	FileNode: FILE_NODE,
	Principal: PRINCIPALS,
	Quota: QUOTA
};

export function usingFor(objectName: string): string[] {
	if (objectName.startsWith('x:')) return [];
	const urn = STANDARD[objectName];
	return urn ? [urn] : [];
}

export function registryGet(objectName: string, id: string): MethodCall {
	return [`${objectName}/get`, { accountId: id }, 'g0'];
}

export function cell(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) return value.map(cell).filter(Boolean).join(', ');
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		if (typeof record.email === 'string') return record.email;
		if (typeof record.name === 'string') return record.name;
		if (typeof record['@type'] === 'string') return record['@type'];
	}
	return '';
}

export function rowCells(row: Record<string, unknown>, names: string[]): Record<string, string> {
	const cells: Record<string, string> = {};
	for (const name of names) cells[name] = cell(row[name]);
	return cells;
}
