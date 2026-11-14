<script lang="ts">
	import Calendar from '$lib/catalog/calendar/Calendar.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import {
		browserZone,
		createCalendar,
		deleteCalendar,
		deleteEvent,
		firstDayOfWeek,
		guestList,
		listCalendars,
		listEvents,
		loadEvent,
		monthGrid,
		myGuest,
		replyToEvent,
		saveEvent,
		addSeconds,
		type CalendarInfo,
		type EventDraft,
		type EventItem
	} from '$lib/adapter/events';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'use-your-calendar')!;
	const self = account()?.username ?? '';
	const timeZone = browserZone();
	const weekStart = firstDayOfWeek();
	const now = new Date();

	let year = $state(now.getFullYear());
	let month = $state(now.getMonth());
	let calendars = $state<CalendarInfo[]>([]);
	let events = $state<EventItem[]>([]);
	let hidden = $state<Set<string>>(new Set());
	let notice = $state('Loading the calendar.');
	let problem = $state('');
	let progress = $state(loadProgress(self, lesson));
	let loadId = 0;

	$effect(() => {
		$lessonsChanged;
		progress = loadProgress(self, lesson);
	});

	function dismissLesson() {
		progress = { ...progress, dismissed: true };
		saveProgress(self, lesson, progress);
		void pushLessonProgress(lesson.id, progress);
	}

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load(forYear: number, forMonth: number) {
		const id = ++loadId;
		const days = monthGrid(forYear, forMonth, weekStart);
		try {
			const [nextCalendars, nextEvents] = await Promise.all([
				listCalendars(),
				listEvents(days[0], addSeconds(`${days[41]}T00:00:00`, 86400).slice(0, 10), timeZone)
			]);
			if (id !== loadId) return;
			calendars = nextCalendars;
			events = nextEvents;
			notice = '';
		} catch (err) {
			if (id !== loadId) return;
			notice = message(err, 'The calendar could not be loaded.');
		}
	}

	$effect(() => {
		void load(year, month);
	});

	function changeMonth(delta: number | null) {
		if (delta === null) {
			const today = new Date();
			year = today.getFullYear();
			month = today.getMonth();
			return;
		}
		const next = new Date(year, month + delta, 1);
		year = next.getFullYear();
		month = next.getMonth();
	}

	async function run(action: () => Promise<unknown>, fallback: string, after?: () => void): Promise<boolean> {
		problem = '';
		try {
			await action();
			after?.();
			await load(year, month);
			return true;
		} catch (err) {
			problem = message(err, fallback);
			return false;
		}
	}

	function save(draft: EventDraft, original?: EventItem) {
		const before = new Set(original?.guests.map((guest) => guest.address));
		const invited = guestList(draft.guests).filter((guest) => !before.has(guest)).length;
		return run(
			() => saveEvent(draft, original),
			'The event could not be saved.',
			() => {
				if (original) mcplEmit('calendar.event.updated', 'calendar');
				else mcplEmit('calendar.event.created', 'calendar');
				if (invited) mcplEmit('calendar.invite.sent', 'calendar', { people: invited });
			}
		);
	}

	async function openForEdit(event: EventItem): Promise<EventItem | null> {
		problem = '';
		try {
			const stored = await loadEvent(event.baseId);
			if (!stored) problem = 'That event is no longer there.';
			return stored;
		} catch (err) {
			problem = message(err, 'The event could not be opened.');
			return null;
		}
	}

	function reply(event: EventItem, status: 'accepted' | 'tentative' | 'declined') {
		const guest = myGuest(event, self);
		if (!guest) return Promise.resolve(false);
		return run(() => replyToEvent(event.baseId, guest.key, status), 'Your reply could not be sent.', () =>
			mcplEmit('calendar.invite.answered', 'calendar', { status })
		);
	}

	function toggle(id: string) {
		const next = new Set(hidden);
		if (!next.delete(id)) next.add(id);
		hidden = next;
	}

</script>

<section class="workspace">
	<Lesson {lesson} {progress} ondismiss={dismissLesson} />
	<Calendar
		{year}
		{month}
		{weekStart}
		{calendars}
		{events}
		{hidden}
		{notice}
		{problem}
		{self}
		{timeZone}
		onmonth={changeMonth}
		ontoggle={toggle}
		onsave={save}
		ondelete={(event) => run(() => deleteEvent(event.baseId), 'The event could not be deleted.', () => mcplEmit('calendar.event.deleted', 'calendar'))}
		onreply={reply}
		onaddcalendar={(name) => run(() => createCalendar(name), 'The calendar could not be created.', () => mcplEmit('calendar.calendar.created', 'calendar'))}
		ondeletecalendar={(calendar) => run(() => deleteCalendar(calendar.id), 'The calendar could not be deleted.')}
		onedit={openForEdit}
	/>
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
