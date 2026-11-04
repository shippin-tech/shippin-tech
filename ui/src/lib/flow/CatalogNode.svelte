<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps = $props();
</script>

<Handle type="target" position={Position.Left} />
<a class="nodrag nopan" href={String(data?.href ?? '#')}>{data?.label}</a>
<Handle type="source" position={Position.Right} />

<style>
	a {
		color: var(--color-text);
		font-weight: 650;
		text-decoration: none;
	}
</style>
