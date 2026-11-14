<script lang="ts">
	import type { UsageLevel } from './resources-call';

	let { label, detail, percent, level }: { label: string; detail: string; percent: number | null; level: UsageLevel } = $props();
</script>

<div class="usage">
	<div class="head"><span>{label}</span><span class="detail">{detail}</span></div>
	{#if percent !== null}
		<meter min="0" max="100" value={percent} aria-label={label}></meter>
	{/if}
	{#if level === 'over'}
		<p class="status"><span aria-hidden="true">●</span> At its limit</p>
	{:else if level === 'near'}
		<p class="status"><span aria-hidden="true">▲</span> Near its limit</p>
	{/if}
</div>

<style>
	.usage { display: grid; gap: 0.25rem; min-width: 0; }
	.head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; }
	.detail { color: var(--color-muted); }
	meter { inline-size: 100%; block-size: 0.5rem; }
	.status { margin: 0; font-weight: 600; }
</style>
