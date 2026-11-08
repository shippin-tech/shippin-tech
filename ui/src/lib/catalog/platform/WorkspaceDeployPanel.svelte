<script lang="ts">
	import { onDestroy } from 'svelte';
	import { portalSignals, publishSignals } from '$lib/adapter/signal';
	import { createSignal, isBlueprintSignal, type PortalSignal } from '$lib/portal/signal';

	let {
		blueprint,
		resource,
		title = 'Queue deployment'
	}: {
		blueprint: string;
		resource: string;
		title?: string;
	} = $props();

	let deploySignals = $state<PortalSignal[]>([]);

	const unsubscribe = portalSignals.subscribe((next) => {
		deploySignals = next.filter((signal) => isBlueprintSignal(signal, blueprint)).slice(-8);
	});
	onDestroy(() => unsubscribe());

	function requestDeployment() {
		publishSignals([
			createSignal({
				channel: 'scripted',
				source: 'scripted-ai',
				eventType: `deploy.blueprint.${blueprint}`,
				resource,
				status: 'pending',
				severity: 'info',
				payload: { blueprint, resource }
			})
		]);
	}
</script>

<div class="workspace-deploy">
	<div class="actions">
		<a href="/platform">Open Platform planner</a>
		<button type="button" onclick={requestDeployment}>{title}</button>
	</div>
	{#if deploySignals.length}
		<section class="feed">
			<h2>Deployment signals</h2>
			<ol>
				{#each deploySignals.slice().reverse() as signal (signal.id)}
					<li><strong>{signal.eventType}</strong> · {signal.timestamp}</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>

<style>
	.workspace-deploy { display: grid; gap: var(--space-2); }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
	button {
		background: var(--color-card);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-3);
	}
	h2 { margin: 0; font-size: var(--step-m); }
	.feed ol { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: var(--space-1); }
</style>
