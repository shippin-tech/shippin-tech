<script lang="ts">
	import { onMount } from 'svelte';
	import Calendar from '$lib/catalog/calendar/Calendar.svelte';
	import { loadEvents, type Named } from '$lib/adapter/groupware';

	let events = $state<Named[]>([]);
	let notice = $state('Loading the calendar.');

	onMount(async () => {
		try {
			events = await loadEvents();
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'The calendar could not be loaded.';
		}
	});
</script>

<Calendar {events} {notice} />
