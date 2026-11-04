<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { postRsvp, type Attendee } from '$lib/adapter/calendar';
	import CalendarRsvp from '$lib/catalog/calendar-rsvp/CalendarRsvp.svelte';
	import { partStats, type PartStat, type RsvpVariant } from '$lib/catalog/calendar-rsvp/variants';

	let variant = $state<RsvpVariant>('invitation');
	let summary = $state('');
	let organizer = $state('');
	let when = $state('');
	let recurrence = $state('');
	let location = $state('');
	let description = $state('');
	let conference = $state('');
	let conferenceUrl = $state('');
	let attendees = $state<Attendee[]>([]);
	let selected = $state<PartStat | ''>('');
	let note = $state('');
	let alert = $state(page.url.searchParams.get('i') ? '' : 'This RSVP link is not valid.');
	let pending = $state(false);
	let recorded = $state('');
	let token = page.url.searchParams.get('i') || '';

	const failure = 'Temporary server failure. If the problem persists, contact your administrator.';

	function isPart(value: string): value is PartStat {
		return (partStats as readonly string[]).includes(value);
	}

	onMount(async () => {
		const preset = (page.url.searchParams.get('m') || '').toLowerCase();
		if (!token) return;
		try {
			const data = await postRsvp({ token });
			if (data.type === 'error') {
				alert = data.message || 'This RSVP link is not valid.';
				return;
			}
			summary = data.summary || '';
			when = data.when || '';
			recurrence = data.recurrence || '';
			location = data.location || '';
			description = data.description || '';
			conference = data.conference?.value || '';
			conferenceUrl = data.conference?.url || '';
			attendees = data.attendees || [];
			const host = attendees.find((person) => person.isOrganizer);
			organizer = host?.name || host?.email || '';
			const kind = data.kind || 'invitation';
			variant = kind === 'cancel' || kind === 'update' ? kind : 'invitation';
			if (isPart(preset)) selected = preset;
			else if (data.partstat && isPart(data.partstat.toLowerCase())) selected = data.partstat.toLowerCase() as PartStat;
		} catch {
			alert = failure;
		}
	});

	function onselect(value: PartStat) {
		if (!pending) selected = value;
	}

	async function onsend() {
		if (!selected || pending) return;
		pending = true;
		alert = '';
		try {
			const resp = await postRsvp({ token, partstat: selected, comment: note.trim() });
			if (resp.type === 'recorded') {
				const part = (resp.partstat || selected).toLowerCase();
				recorded = part + '. The organizer has been notified.';
				variant = 'recorded';
				return;
			}
			alert = resp.message || failure;
		} catch {
			alert = failure;
		} finally {
			pending = false;
		}
	}

	function onchange() {
		variant = 'invitation';
		recorded = '';
	}
</script>

<CalendarRsvp
	{variant}
	{summary}
	{organizer}
	{when}
	{recurrence}
	{location}
	{description}
	{conference}
	{conferenceUrl}
	{attendees}
	bind:selected
	bind:note
	{alert}
	{pending}
	{recorded}
	{onselect}
	{onsend}
	{onchange}
/>
