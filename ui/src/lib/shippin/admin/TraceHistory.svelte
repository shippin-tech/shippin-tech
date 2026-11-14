<script lang="ts">
	import { traceHeadline, type StoredTrace } from '$lib/adapter/trace';
	import type { TraceEvent } from '$lib/portal/trace';
	import TraceDetail from './TraceDetail.svelte';

	type Props = {
		traces: readonly StoredTrace[];
		notice: string;
		more: boolean;
		opened: { trace: StoredTrace; events: TraceEvent[] } | null;
		onsearch: (query: string, kind: string, problems: boolean) => void;
		onmore: () => void;
		onopen: (trace: StoredTrace) => void;
		onclose: () => void;
	};

	let { traces, notice, more, opened, onsearch, onmore, onopen, onclose }: Props = $props();

	let query = $state('');
	let kind = $state('');
	let problems = $state(false);

	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

	function when(seconds: number): string {
		return dateFormat.format(new Date(seconds * 1000));
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsearch(query, kind, problems);
	}
</script>

{#if opened}
	<section class="history" aria-label="Stored trace">
		<h2>{traceHeadline(opened.trace)}</h2>
		<p class="muted">{when(opened.trace.started)}{opened.trace.ip ? ` from ${opened.trace.ip}` : ''}</p>
		<TraceDetail events={opened.events} onback={onclose} />
	</section>
{:else}
	<section class="history" aria-label="Stored traces">
		<form class="filters" onsubmit={submit}>
			<label><span>Search</span><input type="search" bind:value={query} placeholder="Address or IP" /></label>
			<label>
				<span>Kind</span>
				<select bind:value={kind}>
					<option value="">Everything</option>
					<option value="smtp">Incoming</option>
					<option value="delivery">Outgoing</option>
				</select>
			</label>
			<label class="check"><input type="checkbox" bind:checked={problems} /><span>Only problems</span></label>
			<button type="submit">Search traces</button>
		</form>
		{#if notice}<p role="status">{notice}</p>{/if}
		{#if !notice && traces.length === 0}
			<p class="muted">No traces match. Sessions that handled a message or a sign-in are kept here.</p>
		{:else if traces.length}
			<div class="scroll">
				<table>
					<thead>
						<tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Message</th><th scope="col" class="wide">IP</th><th scope="col" class="num">Problems</th></tr>
					</thead>
					<tbody>
						{#each traces as trace (trace.id)}
							<tr>
								<td>{when(trace.started)}</td>
								<td>{trace.kind === 'delivery' ? 'Outgoing' : 'Incoming'}</td>
								<th scope="row"><button type="button" class="link" onclick={() => onopen(trace)}>{traceHeadline(trace)}</button></th>
								<td class="wide">{trace.ip}</td>
								<td class="num">{trace.problems || ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if more}<button type="button" onclick={onmore}>Show older</button>{/if}
		{/if}
	</section>
{/if}

<style>
	.history { display: grid; gap: var(--y-2xs); min-width: 0; }
	h2, p { margin: 0; }
	h2 { font-size: 1.125rem; overflow-wrap: anywhere; }
	.muted { color: var(--color-muted); }
	.filters { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	.filters label { display: grid; gap: 0.25rem; }
	.filters span { font-size: 0.875rem; color: var(--color-muted); }
	.filters .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; }
	.check input { min-height: auto; width: 1.25rem; height: 1.25rem; }
	input:not([type='checkbox']), select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-input); color: var(--color-text); box-sizing: border-box; }
	button { justify-self: start; background: var(--color-card); cursor: pointer; }
	button.link { border: 0; padding: 0; background: none; text-align: start; text-decoration: underline; overflow-wrap: anywhere; }
	.scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border); text-align: start; vertical-align: middle; }
	thead th { color: var(--color-muted); font-size: 0.875rem; }
	th[scope='row'] { font-weight: normal; }
	.num { text-align: end; font-variant-numeric: tabular-nums; }
	@media (max-width: 48rem) { .wide { display: none; } }
</style>
