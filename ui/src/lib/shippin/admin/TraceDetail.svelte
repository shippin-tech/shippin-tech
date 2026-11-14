<script lang="ts">
	import {
		BACK,
		DATE_LABEL,
		DURATION_LABEL,
		EVENTS_LABEL,
		FAILED_LOAD,
		LOADING,
		NOT_FOUND,
		SPAN_TYPE,
		UNRESOLVED,
		eventCount,
		traceSummary,
		type TraceEvent,
		type TraceLoad
	} from '$lib/portal/trace';
	import TraceTimeline from './TraceTimeline.svelte';

	let {
		load = 'ready',
		events = [],
		onback,
		onselect
	}: {
		load?: TraceLoad;
		events?: readonly TraceEvent[];
		onback?: () => void;
		onselect?: (index: number) => void;
	} = $props();

	const summary = $derived(traceSummary(events));
	const problem = $derived(
		load === 'loading'
			? LOADING
			: load === 'failed'
				? FAILED_LOAD
				: load === 'missing'
					? NOT_FOUND
					: load === 'unresolved'
						? UNRESOLVED
						: ''
	);
</script>

<section class="detail">
	<button type="button" onclick={() => onback?.()}>{BACK}</button>
	{#if problem}
		<p role={load === 'loading' ? 'status' : 'alert'}>{problem}</p>
	{:else}
		<dl>
			<div><dt>{SPAN_TYPE}</dt><dd>{summary.span}</dd></div>
			<div><dt>{DATE_LABEL}</dt><dd>{summary.date}</dd></div>
			<div><dt>{DURATION_LABEL}</dt><dd>{summary.duration}</dd></div>
			<div><dt>{EVENTS_LABEL}</dt><dd>{eventCount(summary.count)}</dd></div>
		</dl>
		<TraceTimeline {events} {onselect} />
	{/if}
</section>

<style>
	.detail { display: grid; gap: var(--y-2xs); }
	button {
		font: inherit;
		justify-self: start;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		cursor: pointer;
	}
	button:focus-visible, :global(button:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--x-2xs); margin: 0; }
	dt { color: var(--color-muted); }
	dd { margin: 0; }
	p { margin: 0; }
</style>
