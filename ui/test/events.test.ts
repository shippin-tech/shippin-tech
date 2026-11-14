import { describe, expect, it } from 'vitest';
import {
	addSeconds,
	draftDuration,
	draftFrom,
	draftProblem,
	emptyDraft,
	eventDays,
	eventProperties,
	eventsByDay,
	formatDuration,
	guestList,
	monthGrid,
	myGuest,
	parseDuration,
	participantsFor,
	repeatOf,
	repeatRule,
	secondsBetween,
	toEvent,
	type EventItem
} from '../src/lib/adapter/events-call';

function event(overrides: Partial<EventItem> = {}): EventItem {
	return {
		id: 'i',
		baseId: 'b',
		calendarIds: ['c'],
		title: 'Plan',
		start: '2026-11-20T10:00:00',
		duration: 'PT1H',
		timeZone: 'UTC',
		utcStart: '2026-11-20T10:00:00Z',
		utcEnd: '2026-11-20T11:00:00Z',
		allDay: false,
		location: '',
		description: '',
		repeat: 'none',
		guests: [],
		isOrganizer: true,
		...overrides
	};
}

describe('calendar helpers', () => {
	it('reads and writes durations', () => {
		expect(parseDuration('PT1H30M')).toBe(5400);
		expect(parseDuration('P1DT2H')).toBe(93600);
		expect(parseDuration('P2W')).toBe(1209600);
		expect(parseDuration('nonsense')).toBe(0);
		expect(formatDuration(5400)).toBe('PT1H30M');
		expect(formatDuration(86400)).toBe('P1D');
		expect(formatDuration(0)).toBe('PT0S');
	});

	it('does wall-clock arithmetic across month ends', () => {
		expect(addSeconds('2026-11-30T23:00:00', 3600)).toBe('2026-12-01T00:00:00');
		expect(secondsBetween('2026-11-20T10:00:00', '2026-11-20T11:30:00')).toBe(5400);
	});

	it('lays out six weeks starting on the chosen day', () => {
		const sunday = monthGrid(2026, 10, 0); // November 2026 starts on a Sunday
		expect(sunday).toHaveLength(42);
		expect(sunday[0]).toBe('2026-11-01');
		const monday = monthGrid(2026, 10, 1);
		expect(monday[0]).toBe('2026-10-26');
		expect(monday[6]).toBe('2026-11-01');
	});

	it('places all-day events on every day they cover and sorts each day', () => {
		const holiday = event({ id: 'h', allDay: true, start: '2026-11-26T00:00:00', duration: 'P2D' });
		expect(eventDays(holiday)).toEqual(['2026-11-26', '2026-11-27']);
		const early = event({ id: 'e', start: '2026-11-26T08:00:00', utcStart: '2026-11-26T12:00:00Z', utcEnd: '2026-11-26T12:30:00Z' });
		const list = eventsByDay([early, holiday]).get(eventDays(early)[0]);
		expect(list?.[0].id).toBe('h');
	});

	it('maps repeats both ways and keeps what the form cannot show', () => {
		expect(repeatOf(null)).toBe('none');
		expect(repeatOf({ '@type': 'RecurrenceRule', frequency: 'weekly' })).toBe('weekly');
		expect(repeatOf({ frequency: 'weekly', count: 4 })).toBe('custom');
		expect(repeatRule('monthly')).toEqual({ '@type': 'RecurrenceRule', frequency: 'monthly' });
		expect(repeatRule('none')).toBeNull();
		const properties = eventProperties({ ...emptyDraft('2026-11-20', 'c', 'UTC'), title: 'x', repeat: 'custom' }, 'me@x.test', event());
		expect('recurrenceRule' in properties).toBe(false);
	});

	it('checks the form', () => {
		const draft = { ...emptyDraft('2026-11-20', 'c', 'UTC'), title: 'x' };
		expect(draftProblem(draft)).toBe('');
		expect(draftProblem({ ...draft, title: ' ' })).toContain('title');
		expect(draftProblem({ ...draft, calendarId: '' })).toContain('calendar');
		expect(draftProblem({ ...draft, endTime: '08:00' })).toContain('after the start');
		expect(draftProblem({ ...draft, guests: 'not-an-address' })).toContain('not an email');
		expect(draftProblem({ ...draft, allDay: true, endDate: '2026-11-19' })).toContain('after the start');
		expect(draftProblem({ ...draft, allDay: true })).toBe('');
		expect(guestList('A@x.test, b@x.test; a@x.test')).toEqual(['a@x.test', 'b@x.test']);
	});

	it('builds what the server stores', () => {
		const draft = { ...emptyDraft('2026-11-20', 'c', 'America/New_York'), title: ' Plan ', location: 'Office' };
		const created = eventProperties(draft, 'me@x.test');
		expect(created).toMatchObject({
			'@type': 'Event',
			title: 'Plan',
			calendarIds: { c: true },
			start: '2026-11-20T09:00:00',
			duration: 'PT1H',
			timeZone: 'America/New_York',
			locations: { place: { name: 'Office' } }
		});
		expect('participants' in created).toBe(false);
		const allDay = eventProperties({ ...draft, allDay: true, endDate: '2026-11-21' }, 'me@x.test');
		expect(allDay).toMatchObject({ start: '2026-11-20T00:00:00', duration: 'P2D', showWithoutTime: true });
		expect('timeZone' in allDay).toBe(false);
		expect(draftDuration({ ...draft, allDay: true, endDate: '2026-11-21' })).toBe(86400);
		const cleared = eventProperties({ ...draft, location: '' }, 'me@x.test', event());
		expect(cleared.locations).toBeNull();
		expect(cleared.participants).toBeNull();
	});

	it('invites guests and keeps replies already given', () => {
		expect(participantsFor([], 'me@x.test')).toBeNull();
		const people = participantsFor(['a@x.test', 'b@x.test'], 'me@x.test', [
			{ key: 'kept', address: 'a@x.test', name: 'a', status: 'accepted', isOwner: false }
		])!;
		expect(people.owner).toMatchObject({ calendarAddress: 'mailto:me@x.test', roles: { owner: true, attendee: true } });
		expect(people.kept).toMatchObject({ calendarAddress: 'mailto:a@x.test', participationStatus: 'accepted' });
		expect(people.guest1).toMatchObject({ calendarAddress: 'mailto:b@x.test', participationStatus: 'needs-action', expectReply: true });
	});

	it('reads server events, including who is invited', () => {
		const raw = {
			id: 'h1',
			baseEventId: 'b1',
			calendarIds: { c: true },
			title: 'Sync',
			start: '2026-11-02T09:00:00',
			duration: 'PT30M',
			timeZone: 'America/New_York',
			utcStart: '2026-11-02T14:00:00Z',
			utcEnd: '2026-11-02T14:30:00Z',
			locations: { l: { name: 'Room' } },
			recurrenceRule: null,
			participants: {
				o: { calendarAddress: 'mailto:Boss@x.test', roles: { owner: true }, participationStatus: 'accepted' },
				g: { calendarAddress: 'mailto:me@x.test', roles: { attendee: true }, participationStatus: 'needs-action' }
			}
		};
		const parsed = toEvent(raw, 'me@x.test')!;
		expect(parsed).toMatchObject({ id: 'h1', baseId: 'b1', location: 'Room', isOrganizer: false, calendarIds: ['c'] });
		expect(myGuest(parsed, 'ME@x.test')?.key).toBe('g');
		expect(toEvent({ ...raw, participants: undefined }, 'me@x.test')?.isOrganizer).toBe(true);
		expect(toEvent({ title: 'no id' }, 'me@x.test')).toBeNull();
	});

	it('opens the form with the event as stored', () => {
		const form = draftFrom(event({ guests: [{ key: 'o', address: 'me@x.test', name: '', status: 'accepted', isOwner: true }, { key: 'g', address: 'a@x.test', name: '', status: 'accepted', isOwner: false }] }));
		expect(form).toMatchObject({ startDate: '2026-11-20', startTime: '10:00', endDate: '2026-11-20', endTime: '11:00', guests: 'a@x.test', calendarId: 'c' });
		const allDay = draftFrom(event({ allDay: true, start: '2026-11-26T00:00:00', duration: 'P2D' }));
		expect(allDay).toMatchObject({ startDate: '2026-11-26', endDate: '2026-11-27' });
	});
});
