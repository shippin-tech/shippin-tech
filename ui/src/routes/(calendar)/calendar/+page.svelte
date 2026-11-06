<script lang="ts">
	import { onMount } from 'svelte';
	import Calendar from '$lib/catalog/calendar/Calendar.svelte';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { mailNodes } from '$lib/flow/mail/nodes';
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

<div class="split">
	<Calendar {events} {notice} />
	<section>
		<h2>Mail graph</h2>
		<GraphMount items={mailNodes} />
	</section>
</div>

<style>
	.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr)); gap: var(--x-s); padding-block-end: var(--y-m); }
	h2 { margin: 0 0 var(--space-2); color: var(--color-brand); }
</style>
