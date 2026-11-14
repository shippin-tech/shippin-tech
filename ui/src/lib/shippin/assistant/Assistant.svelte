<script lang="ts">
	import type { Turn } from './assistant-call';

	let {
		turns,
		busy,
		problem,
		onask
	}: {
		turns: Turn[];
		busy: boolean;
		problem: string;
		onask: (question: string) => Promise<boolean>;
	} = $props();

	let open = $state(false);
	let question = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const text = question.trim();
		if (!text || busy) return;
		if (await onask(text)) question = '';
	}
</script>

<div class="assistant">
	{#if open}
		<aside aria-label="Assistant">
			<header>
				<h2>Ask for help</h2>
				<button type="button" onclick={() => (open = false)}>Close</button>
			</header>
			<p class="muted">Explains how things work. It cannot see your mail or change anything. Your questions go to the AI service this server's administrator chose.</p>
			<div class="log" role="log" aria-live="polite" aria-label="Conversation">
				{#each turns as turn, index (index)}
					<p class="turn" data-role={turn.role}><span class="who">{turn.role === 'user' ? 'You' : 'Assistant'}</span> {turn.content}</p>
				{/each}
				{#if busy}<p class="muted">Thinking.</p>{/if}
			</div>
			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
			<form onsubmit={submit}>
				<label>
					<span>Your question</span>
					<textarea bind:value={question} rows="2" maxlength="4000"></textarea>
				</label>
				<button type="submit" class="primary" disabled={busy}>Ask</button>
			</form>
		</aside>
	{:else}
		<button type="button" class="primary" onclick={() => (open = true)}>Ask for help</button>
	{/if}
</div>

<style>
	.assistant { position: fixed; inset-block-end: 1rem; inset-inline-end: 1rem; z-index: 40; max-inline-size: calc(100vw - 2rem); }
	aside { display: grid; gap: 0.5rem; inline-size: min(26rem, calc(100vw - 2rem)); max-block-size: min(36rem, calc(100vh - 2rem)); padding: 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); }
	header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	h2, p { margin: 0; }
	h2 { font-size: 1.125rem; }
	.log { display: grid; gap: 0.5rem; overflow-y: auto; min-block-size: 3rem; align-content: start; }
	.turn { white-space: pre-wrap; overflow-wrap: anywhere; }
	.who { display: block; font-size: 0.875rem; font-weight: 600; color: var(--color-muted); }
	form { display: grid; gap: 0.5rem; }
	label { display: grid; gap: 0.25rem; }
	label span { font-size: 0.875rem; color: var(--color-muted); }
	textarea { font: inherit; inline-size: 100%; padding: 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { font: inherit; min-height: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	.muted { color: var(--color-muted); font-size: 0.875rem; }
	.problem { font-weight: 600; }
</style>
