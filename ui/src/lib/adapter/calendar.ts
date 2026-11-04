import { paths } from './paths';

export type Attendee = {
	name?: string;
	email?: string;
	isOrganizer?: boolean;
};

export type RsvpEvent = {
	type?: string;
	kind?: string;
	summary?: string;
	when?: string;
	recurrence?: string;
	location?: string;
	description?: string;
	partstat?: string;
	message?: string;
	reason?: string;
	conference?: { value?: string; url?: string };
	attendees?: Attendee[];
};

export async function postRsvp(body: {
	token: string;
	partstat?: string;
	comment?: string;
}): Promise<RsvpEvent> {
	const res = await fetch(paths.calendarRsvp, {
		method: 'POST',
		credentials: 'omit',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const json = (await res.json().catch(() => ({ type: 'error', reason: 'serverError' }))) as RsvpEvent;
	return json;
}
