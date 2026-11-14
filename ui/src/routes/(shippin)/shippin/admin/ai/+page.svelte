<script lang="ts">
	import { onMount } from 'svelte';
	import AiSettingsForm from '$lib/shippin/assistant/AiSettingsForm.svelte';
	import LessonFor from '$lib/shippin/LessonFor.svelte';
	import { clearAiSettings, loadAiSettings, saveAiSettings, testAi, type AiDraft, type AiSettings } from '$lib/shippin/assistant/assistant';
	import { mcplEmit } from '$lib/mcpl/events';

	let saved = $state<AiSettings | null>(null);
	let notice = $state('Loading.');
	let problem = $state('');
	let result = $state('');

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			saved = await loadAiSettings();
			notice = '';
		} catch (err) {
			notice = message(err, 'The AI settings could not be loaded.');
		}
	}

	onMount(load);

	async function save(draft: AiDraft) {
		problem = '';
		result = '';
		try {
			await saveAiSettings(draft);
			mcplEmit('ai.settings.saved', 'assistant');
			result = 'Saved.';
			await load();
		} catch (err) {
			problem = message(err, 'The AI settings could not be saved.');
		}
	}

	async function test() {
		problem = '';
		result = '';
		try {
			const answer = await testAi();
			mcplEmit('ai.connection.tested', 'assistant');
			result = `It works. The model answered: ${answer}`;
		} catch (err) {
			problem = message(err, 'That did not work.');
		}
	}

	async function clear() {
		problem = '';
		result = '';
		try {
			await clearAiSettings();
			mcplEmit('ai.settings.removed', 'assistant');
			result = 'Removed.';
			await load();
		} catch (err) {
			problem = message(err, 'The AI settings could not be removed.');
		}
	}
</script>

<svelte:head><title>AI settings</title></svelte:head>

<LessonFor id="turn-on-the-assistant" />
<AiSettingsForm {saved} {notice} {problem} {result} onsave={save} ontest={test} onclear={clear} />
