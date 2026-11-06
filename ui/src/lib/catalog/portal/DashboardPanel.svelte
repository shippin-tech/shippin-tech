<script lang="ts">
	import { dashboard } from '$lib/portal/catalog';
	import MetricsChart from './MetricsChart.svelte';

	let {
		period = '24h',
		metrics = 'pending',
		counts = {},
		points = [],
		onperiod
	}: {
		period?: '24h' | '7d' | '30d' | '90d';
		metrics?: 'pending' | 'signed-out' | 'rejected' | 'failed' | 'ready' | 'disconnected';
		counts?: Record<string, number>;
		points?: readonly { step: number; count: number }[];
		onperiod?: (next: '24h' | '7d' | '30d' | '90d') => void;
	} = $props();

	const periods = [
		{ id: '24h', label: 'Last 24 hours' },
		{ id: '7d', label: 'Last 7 days' },
		{ id: '30d', label: 'Last 30 days' },
		{ id: '90d', label: 'Last 90 days' }
	] as const;
</script>

<h1>Dashboard</h1>
<div class="toolbar">
	<div class="periods" role="group" aria-label="Period">
		{#each periods as item (item.id)}
			<button type="button" aria-pressed={period === item.id} onclick={() => onperiod?.(item.id)}>
				{item.label}
			</button>
		{/each}
	</div>
	<p class="sub">Node: All nodes</p>
</div>
{#if metrics === 'rejected'}
	<p role="status">The server refused the live metrics stream.</p>
{:else if metrics === 'failed'}
	<p role="status">Failed to connect to live metrics.</p>
{:else if metrics === 'disconnected'}
	<p role="status">Live metrics stream disconnected after multiple retries.</p>
{:else if metrics === 'signed-out'}
	<p><a href="/login">Sign in</a></p>
{:else if metrics === 'ready' && points.length === 0}
	<p role="status">No data</p>
{/if}
{#if metrics === 'ready' && points.length > 0}
	<MetricsChart {points} />
{/if}
<div class="cards">
	{#each dashboard as card (card.title)}
		<section>
			<h2>{card.title}</h2>
			{#if counts[card.title] !== undefined}<p class="count">{counts[card.title]}</p>{/if}
			{#if card.description}<p>{card.description}</p>{/if}
		</section>
	{/each}
</div>

<style>
	.toolbar { display: grid; gap: var(--y-2xs); }
	.periods { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	.periods button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
	}
	.periods button[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-color: transparent;
	}
	h1, h2, p { margin: 0; }
	.sub { color: var(--color-muted); }
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr));
		gap: var(--x-s);
	}
	.cards section {
		display: grid;
		gap: var(--y-2xs);
		padding: var(--y-s) var(--x-s);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
</style>
