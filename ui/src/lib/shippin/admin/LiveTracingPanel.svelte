<script lang="ts">
	import {
		ADD_FILTER,
		BUFFER_FULL,
		CONNECTING,
		DISCONNECTED,
		FAILED_START,
		FILTER_KEY,
		FILTER_VALUE,
		KEYWORDS_LABEL,
		KEYWORDS_PLACEHOLDER,
		LIVE_SUBTITLE,
		LIVE_TITLE,
		REFUSED,
		START_TRACING,
		STOP_TRACING,
		STREAMING,
		VALUE_PLACEHOLDER,
		eventCount,
		removeFilterLabel,
		type TraceEvent,
		type TraceFilter
	} from '$lib/portal/trace';
	import TraceDetail from './TraceDetail.svelte';
	import TraceTimeline from './TraceTimeline.svelte';

	let {
		phase = 'idle',
		events = [],
		dropped = 0,
		onstart,
		onstop
	}: {
		phase?: 'signed-out' | 'idle' | 'connecting' | 'rejected' | 'failed' | 'open' | 'disconnected';
		events?: readonly TraceEvent[];
		dropped?: number;
		onstart?: (keywords: string, filters: TraceFilter[]) => void;
		onstop?: () => void;
	} = $props();

	let keywords = $state('');
	let filterKey = $state('');
	let filterValue = $state('');
	let filters = $state<TraceFilter[]>([]);
	let picked = $state<number | null>(null);
	let level = $state('debug');

	const LEVELS = [
		{ id: 'trace', label: 'Everything, including raw traffic' },
		{ id: 'debug', label: 'Detailed (default)' },
		{ id: 'info', label: 'Informational and up' },
		{ id: 'warn', label: 'Warnings and errors' },
		{ id: 'error', label: 'Errors only' }
	] as const;

	const notice = $derived(
		phase === 'connecting'
			? CONNECTING
			: phase === 'open'
				? STREAMING
				: phase === 'rejected'
					? REFUSED
					: phase === 'failed'
						? FAILED_START
						: phase === 'disconnected'
							? DISCONNECTED
							: ''
	);

	function addFilter() {
		const key = filterKey.trim();
		if (!key || key === 'filter' || key === 'token' || key === 'level') return;
		filters = [...filters.filter((item) => item.key !== key), { key, value: filterValue }];
		filterKey = '';
		filterValue = '';
	}
</script>

<section class="live">
	<h1>{LIVE_TITLE}</h1>
	<p>{LIVE_SUBTITLE}</p>
	<label>
		{KEYWORDS_LABEL}
		<input name="keywords" placeholder={KEYWORDS_PLACEHOLDER} bind:value={keywords} />
	</label>
	<label>
		Detail
		<select name="level" bind:value={level}>
			{#each LEVELS as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
		</select>
	</label>
	<div class="filters">
		<label>
			{FILTER_KEY}
			<input name="filter-key" bind:value={filterKey} />
		</label>
		<label>
			{FILTER_VALUE}
			<input name="filter-value" placeholder={VALUE_PLACEHOLDER} bind:value={filterValue} />
		</label>
		<button type="button" onclick={addFilter}>{ADD_FILTER}</button>
	</div>
	{#if filters.length}
		<ul>
			{#each filters as filter (filter.key)}
				<li>
					{filter.key} {filter.value}
					<button type="button" onclick={() => (filters = filters.filter((item) => item.key !== filter.key))}>
						{removeFilterLabel(filter.key)}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if phase === 'open'}
		<button type="button" onclick={() => onstop?.()}>{STOP_TRACING}</button>
	{:else}
		<button type="button" onclick={() => onstart?.(keywords, [{ key: 'level', value: level }, ...filters])}>{START_TRACING}</button>
	{/if}
	{#if phase === 'signed-out'}<p><a href="/login">Sign in</a></p>{/if}
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if events.length}
		<p>{eventCount(events.length)}{#if dropped > 0} {BUFFER_FULL}{/if}</p>
		<TraceDetail {events} onback={() => (picked = null)} onselect={(index) => (picked = index)} />
	{:else}
		<TraceTimeline {events} />
	{/if}
	{#if picked != null && events[picked]}
		<p>{events[picked].event}</p>
	{/if}
</section>

<style>
	.live, .filters { display: grid; gap: var(--y-2xs); }
	h1, p, ul { margin: 0; }
	label { display: grid; gap: var(--y-3xs); }
	input, button, select {
		font: inherit;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-input);
		color: var(--color-text);
	}
	button { justify-self: start; background: var(--color-card); cursor: pointer; }
	input:focus-visible, button:focus-visible, select:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	ul { display: grid; gap: var(--y-3xs); padding-inline-start: var(--x-s); }
</style>
