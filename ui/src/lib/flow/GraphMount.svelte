<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';

	type Item = { id: string; href: string };
	let { items }: { items: readonly Item[] } = $props();
	let Graph = $state<Component<{ items: readonly Item[] }> | null>(null);

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
	.wait { color: var(--color-muted); }
</style>
