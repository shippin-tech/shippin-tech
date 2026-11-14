<script lang="ts">
	import { onMount } from 'svelte';
	import CalendarTemplates from '$lib/shippin/calendar-templates/CalendarTemplates.svelte';
	import { loadCalendarTemplates, resetCalendarTemplate, saveCalendarTemplate, templateLabel, type CalendarTemplate } from '$lib/shippin/calendar-templates/calendar-templates';
	import { mcplEmit } from '$lib/mcpl/events';

	let templates = $state<CalendarTemplate[]>([]);
	let notice = $state('Loading the calendar emails.');
	let problem = $state('');
	let result = $state('');

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			templates = await loadCalendarTemplates();
			notice = '';
		} catch (err) {
			notice = message(err, 'The calendar emails could not be loaded.');
		}
	}

	onMount(load);

	async function save(id: string, source: string) {
		problem = '';
		result = '';
		try {
			await saveCalendarTemplate(id, source);
			mcplEmit('calendar.template.saved', 'calendar-templates');
			result = `${templateLabel(id as CalendarTemplate['id'])} saved.`;
			await load();
		} catch (err) {
			problem = message(err, 'The email could not be saved.');
		}
	}

	async function reset(id: string) {
		problem = '';
		result = '';
		try {
			await resetCalendarTemplate(id);
			mcplEmit('calendar.template.reset', 'calendar-templates');
			result = `${templateLabel(id as CalendarTemplate['id'])} is back to the built-in one.`;
			await load();
		} catch (err) {
			problem = message(err, 'The email could not be reset.');
		}
	}
</script>

<svelte:head><title>Calendar emails</title></svelte:head>

<CalendarTemplates {templates} {notice} {problem} {result} onsave={save} onreset={reset} />
