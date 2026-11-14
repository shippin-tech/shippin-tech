/**
 * Pure helpers for the calendar. The server side is JMAP Calendar and
 * CalendarEvent (crates/jmap/src/calendar, crates/jmap/src/calendar_event);
 * the calls live in adapter/events.ts.
 */

export type CalendarInfo = { id: string; name: string; isDefault: boolean; canWrite: boolean; canDelete: boolean };

export type Guest = { key: string; address: string; name: string; status: string; isOwner: boolean };

export type EventItem = {
	/** The occurrence's id. */
	id: string;
	/** The event itself; differs from `id` for one occurrence of a repeating event. */
	baseId: string;
	calendarIds: string[];
	title: string;
	/** Wall-clock start in the event's own zone, as stored. */
	start: string;
	duration: string;
	timeZone: string | null;
	utcStart: string;
	utcEnd: string;
	allDay: boolean;
	location: string;
	description: string;
	repeat: Repeat;
	guests: Guest[];
	isOrganizer: boolean;
};

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export type EventDraft = {
	title: string;
	calendarId: string;
	allDay: boolean;
	startDate: string;
	startTime: string;
	endDate: string;
	endTime: string;
	repeat: Repeat;
	location: string;
	description: string;
	guests: string;
	timeZone: string | null;
};

export const REPEAT_LABELS: Record<Repeat, string> = {
	none: 'Does not repeat',
	daily: 'Every day',
	weekly: 'Every week',
	monthly: 'Every month',
	yearly: 'Every year',
	custom: 'Custom'
};

export const GUEST_STATUS: Record<string, string> = {
	accepted: 'Going',
	declined: 'Not going',
	tentative: 'Maybe',
	'needs-action': 'Has not replied',
	delegated: 'Delegated'
};

const pad = (value: number) => String(value).padStart(2, '0');

/** A local date as YYYY-MM-DD. */
export function dateKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function timeKey(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Seconds in an ISO 8601 duration such as P1DT2H, PT30M or P2W. */
export function parseDuration(value: string): number {
	const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
	if (!match) return 0;
	const [, weeks, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
	return weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(totalSeconds: number): string {
	const seconds = Math.max(0, Math.round(totalSeconds));
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	const time = `${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${rest ? `${rest}S` : ''}`;
	if (!days && !time) return 'PT0S';
	return `P${days ? `${days}D` : ''}${time ? `T${time}` : ''}`;
}

/** Whole-clock arithmetic on a local date-time, with no time zone involved. */
export function addSeconds(local: string, seconds: number): string {
	const [date, time = '00:00:00'] = local.split('T');
	const [year, month, day] = date.split('-').map(Number);
	const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number);
	const moved = new Date(Date.UTC(year, month - 1, day, hour, minute, second) + seconds * 1000);
	return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}T${pad(moved.getUTCHours())}:${pad(moved.getUTCMinutes())}:${pad(moved.getUTCSeconds())}`;
}

export function secondsBetween(from: string, to: string): number {
	const stamp = (local: string) => {
		const [date, time = '00:00:00'] = local.split('T');
		const [year, month, day] = date.split('-').map(Number);
		const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number);
		return Date.UTC(year, month - 1, day, hour, minute, second);
	};
	return (stamp(to) - stamp(from)) / 1000;
}

/** The 42 days shown for a month, starting on the first day of the week that holds the 1st. */
export function monthGrid(year: number, month: number, weekStart = 0): string[] {
	const first = new Date(year, month, 1);
	const offset = (first.getDay() - weekStart + 7) % 7;
	return Array.from({ length: 42 }, (_, index) => dateKey(new Date(year, month, 1 - offset + index)));
}

/** Which days an event covers, in the viewer's own days. */
export function eventDays(event: EventItem): string[] {
	if (event.allDay) {
		const days = Math.max(1, Math.round(parseDuration(event.duration) / 86400));
		return Array.from({ length: days }, (_, index) => addSeconds(event.start, index * 86400).slice(0, 10));
	}
	const start = new Date(event.utcStart);
	const end = new Date(Math.max(start.getTime(), new Date(event.utcEnd).getTime() - 1000));
	const days: string[] = [];
	for (let at = new Date(start.getFullYear(), start.getMonth(), start.getDate()); at <= end; at.setDate(at.getDate() + 1)) {
		days.push(dateKey(at));
		if (days.length > 366) break;
	}
	return days;
}

/** Each day's events, all-day first, then by start time. */
export function eventsByDay(events: readonly EventItem[]): Map<string, EventItem[]> {
	const byDay = new Map<string, EventItem[]>();
	for (const event of events) {
		for (const day of eventDays(event)) byDay.set(day, [...(byDay.get(day) ?? []), event]);
	}
	for (const list of byDay.values()) {
		list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.utcStart.localeCompare(b.utcStart) || a.title.localeCompare(b.title));
	}
	return byDay;
}

export function repeatOf(rule: unknown): Repeat {
	if (!rule || typeof rule !== 'object') return 'none';
	const parts = rule as Record<string, unknown>;
	const extra = Object.keys(parts).filter((key) => key !== '@type' && key !== 'frequency' && parts[key] !== null);
	const frequency = parts.frequency;
	if (extra.length === 0 && (frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly' || frequency === 'yearly')) return frequency;
	return 'custom';
}

export function repeatRule(repeat: Repeat): Record<string, string> | null {
	return repeat === 'none' || repeat === 'custom' ? null : { '@type': 'RecurrenceRule', frequency: repeat };
}

export function emptyDraft(day: string, calendarId: string, timeZone: string | null, hour = 9): EventDraft {
	const startTime = `${pad(hour)}:00`;
	const endTime = `${pad(Math.min(hour + 1, 23))}:00`;
	return {
		title: '',
		calendarId,
		allDay: false,
		startDate: day,
		startTime,
		endDate: day,
		endTime,
		repeat: 'none',
		location: '',
		description: '',
		guests: '',
		timeZone
	};
}

/** The form for an existing event, in the event's own time zone. */
export function draftFrom(event: EventItem): EventDraft {
	const seconds = parseDuration(event.duration);
	const end = addSeconds(event.start, event.allDay ? Math.max(0, seconds - 86400) : seconds);
	return {
		title: event.title,
		calendarId: event.calendarIds[0] ?? '',
		allDay: event.allDay,
		startDate: event.start.slice(0, 10),
		startTime: event.start.slice(11, 16),
		endDate: end.slice(0, 10),
		endTime: end.slice(11, 16),
		repeat: event.repeat,
		location: event.location,
		description: event.description,
		guests: event.guests.filter((guest) => !guest.isOwner).map((guest) => guest.address).join(', '),
		timeZone: event.timeZone
	};
}

export function guestList(text: string): string[] {
	return [...new Set(text.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

/** What is wrong with the form, or an empty string. */
export function draftProblem(draft: EventDraft): string {
	if (!draft.title.trim()) return 'Give the event a title.';
	if (!draft.calendarId) return 'Choose a calendar.';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)) return 'Enter the dates.';
	if (!draft.allDay && (!/^\d{2}:\d{2}$/.test(draft.startTime) || !/^\d{2}:\d{2}$/.test(draft.endTime))) return 'Enter the times.';
	if (draftDuration(draft) < 0 || (!draft.allDay && draftDuration(draft) === 0)) return 'The end must be after the start.';
	const bad = guestList(draft.guests).find((guest) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest));
	if (bad) return `${bad} is not an email address.`;
	if (guestList(draft.guests).length > 19) return 'An event can have up to 19 guests.';
	return '';
}

function draftStart(draft: EventDraft): string {
	return `${draft.startDate}T${draft.allDay ? '00:00' : draft.startTime}:00`;
}

/** Seconds from start to end as the form has them; negative when the end is first. */
export function draftDuration(draft: EventDraft): number {
	if (draft.allDay) return secondsBetween(`${draft.startDate}T00:00:00`, `${draft.endDate}T00:00:00`);
	return secondsBetween(draftStart(draft), `${draft.endDate}T${draft.endTime}:00`);
}

/** Everyone on the event: the organizer, guests kept with their replies, new guests waiting for one. */
export function participantsFor(guests: readonly string[], organizer: string, existing: readonly Guest[] = []): Record<string, Record<string, unknown>> | null {
	if (guests.length === 0) return null;
	const entries: [string, Record<string, unknown>][] = [
		[
			'owner',
			{
				'@type': 'Participant',
				calendarAddress: `mailto:${organizer}`,
				roles: { owner: true, attendee: true },
				participationStatus: 'accepted'
			}
		]
	];
	guests.forEach((address, index) => {
		const known = existing.find((guest) => guest.address === address);
		entries.push([
			known?.key && known.key !== 'owner' ? known.key : `guest${index}`,
			{
				'@type': 'Participant',
				calendarAddress: `mailto:${address}`,
				roles: { attendee: true },
				participationStatus: known?.status ?? 'needs-action',
				expectReply: true
			}
		]);
	});
	return Object.fromEntries(entries);
}

/** The properties to store for a form, for a new event or as an update. */
export function eventProperties(draft: EventDraft, organizer: string, original?: EventItem): Record<string, unknown> {
	const guests = guestList(draft.guests);
	const properties: Record<string, unknown> = {
		title: draft.title.trim(),
		calendarIds: { [draft.calendarId]: true },
		start: draftStart(draft),
		duration: draft.allDay ? formatDuration(draftDuration(draft) + 86400) : formatDuration(draftDuration(draft)),
		showWithoutTime: draft.allDay,
		timeZone: draft.allDay ? null : draft.timeZone,
		description: draft.description,
		locations: draft.location.trim() ? { place: { '@type': 'Location', name: draft.location.trim() } } : null,
		participants: participantsFor(guests, organizer, original?.guests),
		organizerCalendarAddress: guests.length ? `mailto:${organizer}` : null
	};
	if (draft.repeat !== 'custom') properties.recurrenceRule = repeatRule(draft.repeat);
	if (!original) {
		properties['@type'] = 'Event';
		for (const key of Object.keys(properties)) if (properties[key] === null) delete properties[key];
	}
	return properties;
}

type RawEvent = Record<string, unknown>;

/** Reads a server event. `self` is the signed-in person's address. */
export function toEvent(raw: RawEvent, self: string): EventItem | null {
	if (typeof raw.id !== 'string' || typeof raw.start !== 'string') return null;
	const locations = raw.locations && typeof raw.locations === 'object' ? Object.values(raw.locations as Record<string, { name?: unknown }>) : [];
	const participants = raw.participants && typeof raw.participants === 'object' ? (raw.participants as Record<string, Record<string, unknown>>) : {};
	const guests = Object.entries(participants).map(([key, value]) => {
		const address = typeof value.calendarAddress === 'string' ? value.calendarAddress.replace(/^mailto:/i, '').toLowerCase() : '';
		return {
			key,
			address,
			name: typeof value.name === 'string' ? value.name : address,
			status: typeof value.participationStatus === 'string' ? value.participationStatus : 'needs-action',
			isOwner: !!(value.roles && typeof value.roles === 'object' && (value.roles as Record<string, unknown>).owner)
		};
	});
	const organizer = guests.find((guest) => guest.isOwner)?.address;
	const duration = typeof raw.duration === 'string' ? raw.duration : 'PT0S';
	return {
		id: raw.id,
		baseId: typeof raw.baseEventId === 'string' ? raw.baseEventId : raw.id,
		calendarIds: raw.calendarIds && typeof raw.calendarIds === 'object' ? Object.keys(raw.calendarIds) : [],
		title: typeof raw.title === 'string' && raw.title ? raw.title : 'Untitled',
		start: raw.start,
		duration,
		timeZone: typeof raw.timeZone === 'string' ? raw.timeZone : null,
		utcStart: typeof raw.utcStart === 'string' ? raw.utcStart : `${raw.start}Z`,
		utcEnd: typeof raw.utcEnd === 'string' ? raw.utcEnd : `${addSeconds(raw.start, parseDuration(duration))}Z`,
		allDay: raw.showWithoutTime === true,
		location: typeof (locations[0] as { name?: unknown } | undefined)?.name === 'string' ? ((locations[0] as { name: string }).name) : '',
		description: typeof raw.description === 'string' ? raw.description : '',
		repeat: repeatOf(raw.recurrenceRule),
		guests,
		isOrganizer: guests.length === 0 || organizer === self.toLowerCase()
	};
}

export function myGuest(event: EventItem, self: string): Guest | undefined {
	return event.guests.find((guest) => guest.address === self.toLowerCase() && !guest.isOwner);
}

/** A time zone Intl understands, or null for one the browser cannot name. */
export function browserZone(): string | null {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
	} catch {
		return null;
	}
}

/** The first day of the viewer's week, 0 for Sunday. */
export function firstDayOfWeek(locale?: string): number {
	try {
		const info = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
		const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
		return firstDay === undefined ? 0 : firstDay % 7;
	} catch {
		return 0;
	}
}
