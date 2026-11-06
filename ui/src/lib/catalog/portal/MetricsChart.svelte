<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';

	let { points }: { points: readonly { step: number; count: number }[] } = $props();
	let Chart = $state<Component<{
		data: readonly { step: number; count: number }[];
		x: string;
		y: string;
		height: number;
	}> | null>(null);

	onMount(async () => {
		const mod = await import('layerchart');
		Chart = mod.LineChart;
	});
</script>

{#if points.length > 0 && Chart}
	<Chart data={points} x="step" y="count" height={240} />
{/if}
