<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Assistant from './Assistant.svelte';
	import { askAssistant, assistantEnabled, turnsToSend, type Turn } from './assistant';
	import { mcplEmit } from '$lib/mcpl/events';

	let enabled = $state(false);
	let turns = $state<Turn[]>([]);
	let busy = $state(false);
	let problem = $state('');

	onMount(async () => {
		enabled = await assistantEnabled();
	});

	async function ask(question: string): Promise<boolean> {
		problem = '';
		busy = true;
		const next: Turn[] = [...turns, { role: 'user', content: question }];
		turns = next;
		try {
			const answer = await askAssistant(turnsToSend(next), page.url.pathname);
			turns = [...next, { role: 'assistant', content: answer }];
			mcplEmit('assistant.question.asked', 'assistant');
			return true;
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The assistant could not answer just now.';
			turns = turns.slice(0, -1);
			return false;
		} finally {
			busy = false;
		}
	}
</script>

{#if enabled}
	<Assistant {turns} {busy} {problem} onask={ask} />
{/if}
