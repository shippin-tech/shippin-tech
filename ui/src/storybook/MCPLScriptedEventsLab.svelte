<script lang="ts">
	import { onDestroy } from 'svelte';
	import { bindScriptedSignals, portalSignals } from '$lib/adapter/signal';
	import { SCRIPTED_SIGNAL_EVENT, type PortalSignal } from '$lib/portal/signal';

	let {
		sessionId = 'demo-session',
		term = 'tenant',
		resource = 'workspace-docs'
	}: {
		sessionId?: string;
		term?: string;
		resource?: string;
	} = $props();

	let signals = $state<PortalSignal[]>([]);
	const unsubscribe = portalSignals.subscribe((next) => {
		signals = next.slice(-12);
	});
	const unbind = bindScriptedSignals(window);

	onDestroy(() => {
		unsubscribe();
		unbind();
	});

	function emit(detail: Record<string, unknown>) {
		window.dispatchEvent(new CustomEvent(SCRIPTED_SIGNAL_EVENT, { detail }));
	}

	function learningStarted() {
		emit({
			channel: 'scripted',
			eventType: 'mcpl.learning.session.started',
			resource,
			status: 'open',
			payload: { sessionId, resource }
		});
	}

	function termMatched() {
		emit({
			channel: 'scripted',
			eventType: 'mcpl.learning.term.matched',
			resource,
			status: 'info',
			payload: { sessionId, resource, term, confidence: 0.92 }
		});
	}

	function hintPrompted() {
		emit({
			channel: 'scripted',
			eventType: 'mcpl.learning.hint.prompted',
			resource,
			status: 'pending',
			payload: {
				sessionId,
				term,
				prompt: `Explain ${term} in current workspace context`
			}
		});
	}

	function checkpointCompleted() {
		emit({
			channel: 'scripted',
			eventType: 'mcpl.learning.checkpoint.completed',
			resource,
			status: 'completed',
			payload: { sessionId, term, mastery: 0.78 }
		});
	}
</script>

<section class="lab">
	<h2>MCPL scripted event lab</h2>
	<p>Trigger deterministic learning signals without Playwright screenshots or browser automation.</p>
	<div class="actions">
		<button type="button" onclick={learningStarted}>Start session</button>
		<button type="button" onclick={termMatched}>Match term</button>
		<button type="button" onclick={hintPrompted}>Prompt hint</button>
		<button type="button" onclick={checkpointCompleted}>Complete checkpoint</button>
	</div>
	<div class="meta">
		<span>session: {sessionId}</span>
		<span>resource: {resource}</span>
		<span>term: {term}</span>
	</div>
	{#if signals.length}
		<ol>
			{#each signals.slice().reverse() as signal (signal.id)}
				<li>
					<strong>{signal.eventType}</strong>
					<span>{signal.status}</span>
					<code>{signal.timestamp}</code>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.lab { display: grid; gap: var(--space-2); }
	h2, p { margin: 0; }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	button {
		font: inherit;
		border: 1px solid var(--color-border);
		background: var(--color-card);
		color: var(--color-text);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-3);
	}
	.meta { display: flex; flex-wrap: wrap; gap: var(--space-3); color: var(--color-muted); }
	ol { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: var(--space-1); }
	li { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
	code { font-family: var(--font-mono); font-size: 0.8rem; }
</style>
