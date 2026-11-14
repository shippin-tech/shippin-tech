<script lang="ts">
	import {
		GUEST_STATUS,
		REPEAT_LABELS,
		dateKey,
		draftFrom,
		draftProblem,
		emptyDraft,
		eventsByDay,
		monthGrid,
		myGuest,
		type CalendarInfo,
		type EventDraft,
		type EventItem,
		type Repeat
	} from '$lib/adapter/events-call';

	type Props = {
		year: number;
		month: number;
		weekStart: number;
		calendars: readonly CalendarInfo[];
		events: readonly EventItem[];
		hidden: ReadonlySet<string>;
		notice: string;
		problem: string;
		self: string;
		timeZone: string | null;
		onmonth: (delta: number | null) => void;
		ontoggle: (id: string) => void;
		onsave: (draft: EventDraft, original?: EventItem) => Promise<boolean>;
		ondelete: (event: EventItem) => Promise<boolean>;
		onreply: (event: EventItem, status: 'accepted' | 'tentative' | 'declined') => Promise<boolean>;
		onaddcalendar: (name: string) => Promise<boolean>;
		ondeletecalendar: (calendar: CalendarInfo) => Promise<boolean>;
		onedit: (event: EventItem) => Promise<EventItem | null>;
	};

	let {
		year,
		month,
		weekStart,
		calendars,
		events,
		hidden,
		notice,
		problem,
		self,
		timeZone,
		onmonth,
		ontoggle,
		onsave,
		ondelete,
		onreply,
		onaddcalendar,
		ondeletecalendar,
		onedit
	}: Props = $props();

	type Panel =
		| { kind: 'none' }
		| { kind: 'detail'; event: EventItem }
		| { kind: 'edit'; draft: EventDraft; original?: EventItem }
		| { kind: 'confirm-delete'; event: EventItem };

	let view = $state<'month' | 'agenda'>('month');
	let panel = $state<Panel>({ kind: 'none' });
	let formError = $state('');
	let newCalendar = $state('');
	let addingCalendar = $state(false);

	const today = dateKey(new Date());
	const visible = $derived(events.filter((event) => event.calendarIds.some((id) => !hidden.has(id))));
	const byDay = $derived(eventsByDay(visible));
	const days = $derived(monthGrid(year, month, weekStart));
	const monthPrefix = $derived(`${year}-${String(month + 1).padStart(2, '0')}`);
	const title = $derived(new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
	const weekdays = $derived(
		Array.from({ length: 7 }, (_, index) => new Date(2023, 0, 1 + weekStart + index).toLocaleDateString(undefined, { weekday: 'short' }))
	);
	const agenda = $derived([...byDay.entries()].filter(([day]) => day.startsWith(monthPrefix)).sort(([a], [b]) => a.localeCompare(b)));
	const writable = $derived(calendars.filter((calendar) => calendar.canWrite));

	function timeOf(event: EventItem): string {
		if (event.allDay) return 'All day';
		return new Date(event.utcStart).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}

	function whenText(event: EventItem): string {
		if (event.allDay) return new Date(`${event.start.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'full' });
		const start = new Date(event.utcStart);
		const end = new Date(event.utcEnd);
		const day = start.toLocaleDateString(undefined, { dateStyle: 'full' });
		const from = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		const to = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		return `${day}, ${from} to ${to}`;
	}

	function dayLabel(day: string): string {
		return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	}

	function slot(id: string | undefined): number {
		const index = calendars.findIndex((calendar) => calendar.id === id);
		return index < 0 ? 0 : index % 4;
	}

	function close() {
		panel = { kind: 'none' };
		formError = '';
	}

	function newEvent(day: string) {
		formError = '';
		panel = { kind: 'edit', draft: emptyDraft(day, writable[0]?.id ?? '', timeZone) };
	}

	async function edit(event: EventItem) {
		formError = '';
		const stored = await onedit(event);
		if (stored) panel = { kind: 'edit', draft: draftFrom(stored), original: stored };
	}

	async function submit(submitEvent: SubmitEvent, draft: EventDraft, original?: EventItem) {
		submitEvent.preventDefault();
		formError = draftProblem(draft);
		if (formError) return;
		if (await onsave(draft, original)) close();
	}

	async function remove(event: EventItem) {
		if (await ondelete(event)) close();
	}

	async function reply(event: EventItem, status: 'accepted' | 'tentative' | 'declined') {
		if (await onreply(event, status)) close();
	}

	async function addCalendar(event: SubmitEvent) {
		event.preventDefault();
		if (!newCalendar.trim()) return;
		if (await onaddcalendar(newCalendar)) {
			newCalendar = '';
			addingCalendar = false;
		}
	}
</script>

<section class="cal">
	{#if notice === 'sign-in required'}
		<h1>Calendar</h1>
		<p><a href="/login">Sign in</a> to see your calendar.</p>
	{:else if notice}
		<h1>Calendar</h1>
		<p role="status">{notice}</p>
	{:else}
		<header class="top">
			<h1>Calendar</h1>
			<div class="nav" role="group" aria-label="Month">
				<button type="button" aria-label="Previous month" onclick={() => onmonth(-1)}>‹</button>
				<button type="button" onclick={() => onmonth(null)}>Today</button>
				<button type="button" aria-label="Next month" onclick={() => onmonth(1)}>›</button>
				<h2 aria-live="polite">{title}</h2>
			</div>
			<div class="nav">
				<div class="switch" role="group" aria-label="View">
					<button type="button" aria-pressed={view === 'month'} onclick={() => (view = 'month')}>Month</button>
					<button type="button" aria-pressed={view === 'agenda'} onclick={() => (view = 'agenda')}>Agenda</button>
				</div>
				<button type="button" class="primary" onclick={() => newEvent(today)}>New event</button>
			</div>
		</header>

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		<div class="layout">
			<aside aria-label="Calendars">
				<h2>Calendars</h2>
				<ul>
					{#each calendars as calendar (calendar.id)}
						<li>
							<label>
								<input type="checkbox" checked={!hidden.has(calendar.id)} onchange={() => ontoggle(calendar.id)} />
								<i class="dot s{slot(calendar.id)}"></i>
								<span>{calendar.name}</span>
							</label>
							{#if calendar.canDelete}
								<button type="button" class="link" aria-label="Delete calendar {calendar.name}" onclick={() => ondeletecalendar(calendar)}>Delete</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if addingCalendar}
					<form onsubmit={addCalendar}>
						<label><span class="sr">Calendar name</span><input placeholder="Calendar name" aria-label="Calendar name" bind:value={newCalendar} /></label>
						<button type="submit">Add</button>
						<button type="button" onclick={() => (addingCalendar = false)}>Cancel</button>
					</form>
				{:else}
					<button type="button" onclick={() => (addingCalendar = true)}>New calendar</button>
				{/if}
			</aside>

			<div class="main">
				{#if view === 'month'}
					<div class="grid" role="grid" aria-label={title}>
						<div class="row head" role="row">
							{#each weekdays as weekday (weekday)}<div role="columnheader">{weekday}</div>{/each}
						</div>
						{#each [0, 1, 2, 3, 4, 5] as week (week)}
							<div class="row" role="row">
								{#each days.slice(week * 7, week * 7 + 7) as day (day)}
									{@const list = byDay.get(day) ?? []}
									<div class="day" class:other={!day.startsWith(monthPrefix)} class:today={day === today} role="gridcell">
										<button type="button" class="num" aria-label="New event on {dayLabel(day)}" onclick={() => newEvent(day)}>{Number(day.slice(8))}</button>
										{#each list.slice(0, 3) as event (`${event.id}-${day}`)}
											<button type="button" class="chip s{slot(event.calendarIds[0])}" onclick={() => (panel = { kind: 'detail', event })}>
												{#if !event.allDay}<span class="time">{timeOf(event)}</span>{/if}
												{event.title}
											</button>
										{/each}
										{#if list.length > 3}<span class="more">+{list.length - 3} more</span>{/if}
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{:else if agenda.length === 0}
					<p class="empty">Nothing this month.</p>
				{:else}
					<ol class="agenda">
						{#each agenda as [day, list] (day)}
							<li>
								<h3>{dayLabel(day)}</h3>
								<ul>
									{#each list as event (`${event.id}-${day}`)}
										<li>
											<button type="button" class="line" onclick={() => (panel = { kind: 'detail', event })}>
												<i class="dot s{slot(event.calendarIds[0])}"></i>
												<span class="time">{timeOf(event)}</span>
												<span>{event.title}</span>
											</button>
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ol>
				{/if}
			</div>

			{#if panel.kind !== 'none'}
				<section class="panel" aria-label="Event">
					{#if panel.kind === 'detail'}
						{@const event = panel.event}
						{@const invite = myGuest(event, self)}
						<h2>{event.title}</h2>
						<p>{whenText(event)}</p>
						{#if event.repeat !== 'none'}<p class="muted">{REPEAT_LABELS[event.repeat]}</p>{/if}
						{#if event.location}<p>{event.location}</p>{/if}
						{#if event.description}<p class="body">{event.description}</p>{/if}
						{#if event.guests.length}
							<h3>People</h3>
							<ul class="guests">
								{#each event.guests as guest (guest.key)}
									<li>{guest.address} <span class="muted">{guest.isOwner ? 'Organizer' : (GUEST_STATUS[guest.status] ?? guest.status)}</span></li>
								{/each}
							</ul>
						{/if}
						{#if invite}
							<div class="actions" role="group" aria-label="Your reply">
								<button type="button" aria-pressed={invite.status === 'accepted'} onclick={() => reply(event, 'accepted')}>Going</button>
								<button type="button" aria-pressed={invite.status === 'tentative'} onclick={() => reply(event, 'tentative')}>Maybe</button>
								<button type="button" aria-pressed={invite.status === 'declined'} onclick={() => reply(event, 'declined')}>Not going</button>
							</div>
						{/if}
						<div class="actions">
							{#if event.isOrganizer}
								<button type="button" onclick={() => edit(event)}>Edit</button>
								<button type="button" onclick={() => (panel = { kind: 'confirm-delete', event })}>Delete</button>
							{/if}
							<button type="button" onclick={close}>Close</button>
						</div>
					{:else if panel.kind === 'confirm-delete'}
						{@const event = panel.event}
						<p role="alert">
							Delete {event.title}{event.repeat !== 'none' ? ' and all its repeats' : ''}?{event.guests.length ? ' Guests will be told.' : ''}
						</p>
						<div class="actions">
							<button type="button" class="danger" onclick={() => remove(event)}>Delete event</button>
							<button type="button" onclick={close}>Cancel</button>
						</div>
					{:else}
						{@const draft = panel.draft}
						{@const original = panel.original}
						<form class="form" onsubmit={(event) => submit(event, draft, original)}>
							<h2>{original ? 'Edit event' : 'New event'}</h2>
							<label><span>Title</span><input bind:value={draft.title} /></label>
							{#if writable.length > 1}
								<label>
									<span>Calendar</span>
									<select bind:value={draft.calendarId}>
										{#each writable as calendar (calendar.id)}<option value={calendar.id}>{calendar.name}</option>{/each}
									</select>
								</label>
							{/if}
							<label class="check"><input type="checkbox" bind:checked={draft.allDay} /><span>All day</span></label>
							<div class="pair">
								<label><span>Starts</span><input type="date" bind:value={draft.startDate} /></label>
								{#if !draft.allDay}<label><span>At</span><input type="time" bind:value={draft.startTime} /></label>{/if}
							</div>
							<div class="pair">
								<label><span>Ends</span><input type="date" bind:value={draft.endDate} /></label>
								{#if !draft.allDay}<label><span>Until</span><input type="time" bind:value={draft.endTime} /></label>{/if}
							</div>
							{#if draft.timeZone && draft.timeZone !== timeZone && !draft.allDay}<p class="muted">Times are in {draft.timeZone}.</p>{/if}
							<label>
								<span>Repeats</span>
								<select bind:value={draft.repeat}>
									{#each ['none', 'daily', 'weekly', 'monthly', 'yearly'] as Repeat[] as repeat (repeat)}
										<option value={repeat}>{REPEAT_LABELS[repeat]}</option>
									{/each}
									{#if draft.repeat === 'custom'}<option value="custom">{REPEAT_LABELS.custom}</option>{/if}
								</select>
							</label>
							<label><span>Location</span><input bind:value={draft.location} /></label>
							<label><span>Guests</span><input bind:value={draft.guests} placeholder="name@example.com, another@example.com" /></label>
							<label><span>Description</span><textarea rows="3" bind:value={draft.description}></textarea></label>
							{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
							<div class="actions">
								<button type="submit" class="primary">Save event</button>
								<button type="button" onclick={close}>Cancel</button>
							</div>
						</form>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</section>

<style>
	.cal {
		--series-0: light-dark(#2a78d6, #3987e5);
		--series-1: light-dark(#eb6834, #d95926);
		--series-2: light-dark(#1baf7a, #199e70);
		--series-3: light-dark(#eda100, #c98500);
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-2);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		min-width: 0;
	}
	h1, h2, h3, p, ul, ol { margin: 0; }
	h1 { color: var(--color-brand); }
	h2 { font-size: 1.125rem; }
	h3 { font-size: 0.9375rem; }
	ul, ol { padding: 0; list-style: none; }
	.top, .nav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	.top { justify-content: space-between; }
	.switch { display: flex; gap: 0.25rem; }
	button, input, select, textarea {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
	}
	textarea { padding-block: 0.5rem; min-height: 5rem; resize: vertical; }
	button { cursor: pointer; }
	button.primary, button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	button.link { border: 0; background: none; padding: 0; text-decoration: underline; color: var(--color-muted); }
	.problem { font-weight: 600; }
	.muted, .empty { color: var(--color-muted); }
	.layout { display: grid; grid-template-columns: minmax(11rem, 14rem) minmax(0, 1fr) auto; gap: var(--space-2); align-items: start; }
	aside { display: grid; gap: var(--space-2); }
	aside ul { display: grid; gap: 0.25rem; }
	aside li { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	aside label { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; overflow-wrap: anywhere; }
	aside input[type='checkbox'] { min-height: auto; width: 1.25rem; height: 1.25rem; padding: 0; }
	aside form { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	aside form label, aside form input { width: 100%; }
	.dot { flex: none; width: 0.75rem; height: 0.75rem; border-radius: 3px; display: inline-block; }
	.s0 { --tone: var(--series-0); }
	.s1 { --tone: var(--series-1); }
	.s2 { --tone: var(--series-2); }
	.s3 { --tone: var(--series-3); }
	.dot { background: var(--tone); }
	.main { min-width: 0; overflow-x: auto; }
	.grid { display: grid; gap: 1px; min-width: 40rem; background: var(--color-border); border: 1px solid var(--color-border); }
	.row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; }
	.head div { background: var(--color-card); padding: 0.25rem 0.5rem; font-size: 0.8125rem; color: var(--color-muted); }
	.day { background: var(--color-card); min-height: 6.5rem; padding: 0.125rem; display: grid; gap: 2px; align-content: start; }
	.day.other { background: var(--color-bg); }
	.day.other .num { color: var(--color-muted); }
	.num { justify-self: start; border: 0; background: none; min-height: 2rem; min-width: 2rem; padding: 0 0.375rem; border-radius: 999px; font-variant-numeric: tabular-nums; }
	.day.today .num { background: var(--color-accent); color: var(--color-accent-fg); font-weight: 600; }
	.chip {
		min-height: 1.75rem;
		padding: 0 0.375rem;
		text-align: start;
		font-size: 0.8125rem;
		border: 0;
		border-inline-start: 3px solid var(--tone);
		border-radius: 3px;
		background: color-mix(in srgb, var(--tone) 12%, transparent);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.time { color: var(--color-muted); font-variant-numeric: tabular-nums; }
	.more { font-size: 0.75rem; color: var(--color-muted); padding-inline: 0.375rem; }
	.agenda { display: grid; gap: var(--space-2); }
	.agenda li ul { display: grid; gap: 0.125rem; }
	.line { width: 100%; display: flex; gap: 0.75rem; align-items: center; text-align: start; }
	.panel { width: min(100%, 22rem); display: grid; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); }
	.body { white-space: pre-wrap; }
	.guests { display: grid; gap: 0.25rem; overflow-wrap: anywhere; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.form { display: grid; gap: 0.75rem; }
	.form label { display: grid; gap: 0.25rem; }
	.form label span { font-size: 0.875rem; color: var(--color-muted); }
	.form input, .form select, .form textarea { width: 100%; box-sizing: border-box; }
	.form .check { display: flex; align-items: center; gap: 0.5rem; }
	.form .check input { width: 1.25rem; height: 1.25rem; min-height: auto; }
	.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (max-width: 64rem) {
		.layout { grid-template-columns: minmax(0, 1fr); }
		.panel { width: auto; }
	}
</style>
