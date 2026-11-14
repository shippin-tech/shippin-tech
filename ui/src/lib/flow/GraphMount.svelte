<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import type { GraphItem } from './item';

	let { items }: { items: readonly GraphItem[] } = $props();
	let Graph = $state<Component<{ items: readonly GraphItem[] }> | null>(null);

	onMount(async () => {
		Graph = (await import('./Graph.svelte')).default;
	});
</script>

{#if Graph}
	<Graph {items} />
{:else}
	<p class="wait">Loading the graph.</p>
{/if}

<style>
	.wait {
		color: var(--color-muted);
	}
</style>
