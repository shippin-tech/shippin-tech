<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps = $props();
</script>

<div class="node">
	<Handle type="target" position={Position.Left} />
	<a class="nodrag nopan" href={String(data?.href ?? '#')}>{data?.label}</a>
	<Handle type="source" position={Position.Right} />
</div>

<style>
	.node {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
	}

	a {
		display: block;
		padding: var(--space-2) var(--space-3);
		color: var(--color-text);
		font-weight: 650;
		white-space: nowrap;
		text-decoration: none;
	}
</style>
