<script lang="ts">
	import { SvelteFlow, Background, Controls, type Node, type Edge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import CatalogNode from './CatalogNode.svelte';

	type Item = { id: string; href: string };
	let { items }: { items: readonly Item[] } = $props();

	const nodeTypes = { catalog: CatalogNode };

	const nodes = $derived<Node[]>(
		items.map((item, index) => ({
			id: item.id,
			type: 'catalog',
			position: { x: (index % 3) * 220, y: Math.floor(index / 3) * 140 },
			data: { label: item.id, href: item.href }
		}))
	);
	const edges = $derived<Edge[]>(
		items.slice(1).map((item, index) => ({
			id: `${items[index].id}-${item.id}`,
			source: items[index].id,
			target: item.id
		}))
	);
</script>

<div class="graph">
	<SvelteFlow {nodes} {edges} {nodeTypes} fitView>
		<Background />
		<Controls />
	</SvelteFlow>
</div>

<style>
	.graph {
		height: 28rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		--xy-background-color: var(--color-card);
		--xy-node-background-color: var(--color-bg);
		--xy-node-color: var(--color-text);
		--xy-node-border: 1px solid var(--color-border);
		--xy-edge-stroke: var(--color-brand);
		--xy-background-pattern-dots-color: var(--color-border);
		--xy-handle-background-color: var(--color-brand);
		--xy-controls-button-background-color: var(--color-card);
		--xy-controls-button-color: var(--color-text);
		--xy-controls-button-border-color: var(--color-border);
	}
</style>
