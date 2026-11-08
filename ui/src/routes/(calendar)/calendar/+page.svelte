<script lang="ts">
	import { onMount } from 'svelte';
	import Calendar from '$lib/catalog/calendar/Calendar.svelte';
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';
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

<section class="workspace">
	<WorkspaceDeployPanel blueprint="mail" resource="workspace-calendar" title="Queue calendar deployment" />
	<Calendar {events} {notice} />
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
