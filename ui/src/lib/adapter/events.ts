import { accountId, idsOf, jmap, listOf, type MethodResponse } from './jmap';
import { account } from './session';
import { eventProperties, toEvent, type CalendarInfo, type EventDraft, type EventItem } from './events-call';

export * from './events-call';

const CALENDARS = 'urn:ietf:params:jmap:calendars';
const EVENT_PROPERTIES = [
	'id',
	'baseEventId',
	'calendarIds',
	'title',
	'start',
	'duration',
	'timeZone',
	'utcStart',
	'utcEnd',
	'showWithoutTime',
	'locations',
	'description',
	'recurrenceRule',
	'participants'
];

type SetPayload = {
	created?: Record<string, { id?: string }>;
	notCreated?: Record<string, { description?: unknown }>;
	updated?: Record<string, unknown>;
	notUpdated?: Record<string, { description?: unknown }>;
	destroyed?: string[];
	notDestroyed?: Record<string, { description?: unknown }>;
};

function setPayload(responses: MethodResponse[], method: string): SetPayload {
	return (responses.find((response) => response[0] === method)?.[1] ?? {}) as SetPayload;
}

function reason(error: { description?: unknown } | undefined, fallback: string): string {
	return typeof error?.description === 'string' && error.description ? error.description : fallback;
}

function self(): string {
	return account()?.username ?? '';
}

export async function listCalendars(): Promise<CalendarInfo[]> {
	const responses = await jmap([CALENDARS], [['Calendar/get', { accountId: accountId() }, 'c']]);
	return listOf<{ id?: unknown; name?: unknown; isDefault?: unknown; myRights?: Record<string, unknown> }>(responses, 'Calendar/get')
		.flatMap((row) =>
			typeof row.id === 'string'
				? [
						{
							id: row.id,
							name: String(row.name ?? 'Calendar'),
							isDefault: row.isDefault === true,
							canWrite: row.myRights?.mayWriteAll === true,
							canDelete: row.myRights?.mayDelete === true && row.isDefault !== true
						}
					]
				: []
		)
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export async function createCalendar(name: string): Promise<void> {
	const payload = setPayload(
		await jmap([CALENDARS], [['Calendar/set', { accountId: accountId(), create: { c: { name: name.trim() } } }, 's']]),
		'Calendar/set'
	);
	if (!payload.created?.c?.id) throw new Error(reason(payload.notCreated?.c, 'The calendar could not be created.'));
}

export async function deleteCalendar(id: string): Promise<void> {
	const payload = setPayload(
		await jmap([CALENDARS], [['Calendar/set', { accountId: accountId(), destroy: [id], onDestroyRemoveEvents: true }, 's']]),
		'Calendar/set'
	);
	if (!payload.destroyed?.includes(id)) throw new Error(reason(payload.notDestroyed?.[id], 'The calendar could not be deleted.'));
}

/** Every occurrence between two local dates (YYYY-MM-DD, end exclusive). */
export async function listEvents(from: string, to: string, timeZone: string | null): Promise<EventItem[]> {
	const id = accountId();
	const responses = await jmap(
		[CALENDARS],
		[
			[
				'CalendarEvent/query',
				{
					accountId: id,
					filter: { after: `${from}T00:00:00`, before: `${to}T00:00:00` },
					expandRecurrences: true,
					limit: 2000,
					...(timeZone ? { timeZone } : {})
				},
				'q'
			],
			['CalendarEvent/get', { accountId: id, '#ids': { resultOf: 'q', name: 'CalendarEvent/query', path: '/ids' }, properties: EVENT_PROPERTIES }, 'g']
		]
	);
	if (!idsOf(responses, 'CalendarEvent/query').length) return [];
	return listOf<Record<string, unknown>>(responses, 'CalendarEvent/get').flatMap((raw) => toEvent(raw, self()) ?? []);
}

/** The event itself, as stored, for editing the whole of a repeating event. */
export async function loadEvent(baseId: string): Promise<EventItem | null> {
	const responses = await jmap([CALENDARS], [['CalendarEvent/get', { accountId: accountId(), ids: [baseId], properties: EVENT_PROPERTIES }, 'g']]);
	const raw = listOf<Record<string, unknown>>(responses, 'CalendarEvent/get')[0];
	return raw ? toEvent(raw, self()) : null;
}

/** Saves a form. Guests are told by email, because the server sends the invitations. */
export async function saveEvent(draft: EventDraft, original?: EventItem): Promise<void> {
	const properties = eventProperties(draft, self(), original);
	const args = original ? { update: { [original.baseId]: properties } } : { create: { e: properties } };
	const payload = setPayload(
		await jmap([CALENDARS], [['CalendarEvent/set', { accountId: accountId(), sendSchedulingMessages: true, ...args }, 's']]),
		'CalendarEvent/set'
	);
	if (original) {
		if (!payload.updated || !(original.baseId in payload.updated)) throw new Error(reason(payload.notUpdated?.[original.baseId], 'The event could not be saved.'));
	} else if (!payload.created?.e?.id) {
		throw new Error(reason(payload.notCreated?.e, 'The event could not be created.'));
	}
}

export async function deleteEvent(baseId: string): Promise<void> {
	const payload = setPayload(
		await jmap([CALENDARS], [['CalendarEvent/set', { accountId: accountId(), sendSchedulingMessages: true, destroy: [baseId] }, 's']]),
		'CalendarEvent/set'
	);
	if (!payload.destroyed?.includes(baseId)) throw new Error(reason(payload.notDestroyed?.[baseId], 'The event could not be deleted.'));
}

/** Replies to an invitation; the organizer is told by email. */
export async function replyToEvent(baseId: string, guestKey: string, status: 'accepted' | 'tentative' | 'declined'): Promise<void> {
	const payload = setPayload(
		await jmap(
			[CALENDARS],
			[['CalendarEvent/set', { accountId: accountId(), sendSchedulingMessages: true, update: { [baseId]: { [`participants/${guestKey}/participationStatus`]: status } } }, 's']]
		),
		'CalendarEvent/set'
	);
	if (!payload.updated || !(baseId in payload.updated)) throw new Error(reason(payload.notUpdated?.[baseId], 'Your reply could not be sent.'));
}

