<script lang="ts">
	import { NO_EVENTS, eventTone, type TraceEvent } from '$lib/portal/trace';

	let {
		events = [],
		onselect
	}: {
		events?: readonly TraceEvent[];
		onselect?: (index: number) => void;
	} = $props();
</script>

{#if events.length === 0}
	<p role="status">{NO_EVENTS}</p>
{:else}
	<ol>
		{#each events as item, index (`${item.timestamp}-${item.event}-${index}`)}
			<li data-tone={eventTone(item.event)}>
				<button type="button" onclick={() => onselect?.(index)}>{item.event}</button>
				{#each item.keyValues as pair, pairIndex (`${pair.key}-${pairIndex}`)}
					<span>{pair.key}</span>
					<span>{pair.value.text}</span>
				{/each}
			</li>
		{/each}
	</ol>
{/if}

<style>
	p, ol { margin: 0; }
	ol { display: grid; gap: var(--y-2xs); padding-inline-start: var(--x-s); }
	li { display: grid; grid-template-columns: auto 1fr; gap: var(--x-3xs); }
	li[data-tone='error'] { color: var(--color-danger); }
	button {
		font: inherit;
		justify-self: start;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: inherit;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
