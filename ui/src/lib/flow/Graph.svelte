<script lang="ts">
	import { SvelteFlow, Background, Controls, type Node, type Edge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import CatalogNode from './CatalogNode.svelte';
	import type { GraphItem } from './item';

	let { items }: { items: readonly GraphItem[] } = $props();

	const nodeTypes = { catalog: CatalogNode };

	const nodes = $derived<Node[]>(place(items));
	const edges = $derived<Edge[]>(link(items));

	function linear(list: readonly GraphItem[]): boolean {
		return list.every((item, index) => (index === 0 ? !item.parent : item.parent === list[index - 1].id));
	}

	function place(list: readonly GraphItem[]): Node[] {
		if (linear(list)) {
			return list.map((item, index) => ({
				id: item.id,
				type: 'catalog',
				position: { x: index * 280, y: 0 },
				data: { label: item.label ?? item.id, href: item.href }
			}));
		}
		const children = new Map<string, GraphItem[]>();
		const roots: GraphItem[] = [];
		for (const item of list) {
			if (!item.parent) {
				roots.push(item);
				continue;
			}
			const group = children.get(item.parent) ?? [];
			group.push(item);
			children.set(item.parent, group);
		}
		const placed: Node[] = [];
		let row = 0;
		const walk = (item: GraphItem, depth: number) => {
			placed.push({
				id: item.id,
				type: 'catalog',
				position: { x: depth * 280, y: row * 64 },
				data: { label: item.label ?? item.id, href: item.href }
			});
			row += 1;
			for (const child of children.get(item.id) ?? []) walk(child, depth + 1);
		};
		const start = roots.length > 0 ? roots : [...list];
		for (const root of start) walk(root, 0);
		return placed;
	}

	function link(list: readonly GraphItem[]): Edge[] {
		if (list.some((item) => item.parent)) {
			return list.flatMap((item) =>
				item.parent
					? [{ id: `${item.parent}-${item.id}`, source: item.parent, target: item.id }]
					: []
			);
		}
		return list.slice(1).map((item, index) => ({
			id: `${list[index].id}-${item.id}`,
			source: list[index].id,
			target: item.id
		}));
	}
</script>

<div class="graph">
	<SvelteFlow {nodes} {edges} {nodeTypes} fitView={false} nodesDraggable={false}>
		<Background />
		<Controls />
	</SvelteFlow>
</div>

<style>
	.graph {
		block-size: var(--img-s);
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

	.graph :global(.svelte-flow__controls) {
		left: auto;
		right: var(--space-2);
	}
</style>
