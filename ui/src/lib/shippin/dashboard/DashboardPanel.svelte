<script lang="ts">
	import { dashboards } from '$lib/portal/catalog';
	import {
		PERIODS,
		barLabels,
		cardPrevious,
		cardValue,
		chartSeries,
		combine,
		deltaPercent,
		formatValue,
		fromLocalInput,
		isCustom,
		metricRows,
		toLocalInput,
		type DashboardTab,
		type Stats,
		type StatsRange,
		type StatsStatus
	} from '$lib/shippin/dashboard/stats-call';
	import BarChart from './BarChart.svelte';

	let {
		range = { period: '24h' },
		node = null,
		status = 'pending',
		stats = null,
		loading = false,
		message = '',
		tab = 'overview',
		mode = 'bars',
		updated = null,
		onrange,
		onnode,
		ontab,
		onmode,
		onrefresh
	}: {
		range?: StatsRange;
		node?: number | null;
		status?: 'pending' | StatsStatus;
		stats?: Stats | null;
		loading?: boolean;
		message?: string;
		tab?: string;
		mode?: 'bars' | 'lines';
		updated?: number | null;
		onrange?: (next: StatsRange) => void;
		onnode?: (next: number | null) => void;
		ontab?: (next: string) => void;
		onmode?: (next: 'bars' | 'lines') => void;
		onrefresh?: () => void;
	} = $props();

	const ALL = 'all';
	const tabs: readonly DashboardTab[] = dashboards;

	let filter = $state('');
	let picked = $state<string | null>(null);
	let customOpen = $state(false);
	let fromText = $state('');
	let toText = $state('');
	let customError = $state('');

	const shortDate = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	function openCustom() {
		customOpen = !customOpen;
		if (!customOpen) return;
		const now = Math.floor(Date.now() / 1000);
		fromText = toLocalInput(isCustom(range) ? range.from : now - 86_400);
		toText = toLocalInput(isCustom(range) ? range.to : now);
		customError = '';
	}

	function applyCustom(event: SubmitEvent) {
		event.preventDefault();
		const from = fromLocalInput(fromText);
		const to = fromLocalInput(toText);
		if (from === null || to === null) {
			customError = 'Enter both a start and an end.';
			return;
		}
		if (from >= to) {
			customError = 'The start must be before the end.';
			return;
		}
		customError = '';
		customOpen = false;
		onrange?.({ from, to });
	}

	const current = $derived(tabs.find((item) => item.id === tab) ?? (tab === ALL ? null : tabs[0]));
	const labels = $derived(stats ? barLabels(stats) : []);
	const periodLabel = $derived(
		isCustom(range)
			? shortDate.format(new Date(range.from * 1000)) + ' – ' + shortDate.format(new Date(range.to * 1000))
			: (PERIODS.find((item) => item.id === range.period)?.label.toLowerCase() ?? '')
	);
	const badge = $derived(isCustom(range) ? 'this range' : periodLabel);
	const rows = $derived(stats ? metricRows(stats, filter) : []);
	const pickedSeries = $derived(picked && stats?.history[picked] ? stats.history[picked] : null);
	const pickedRow = $derived(picked ? rows.find((row) => row.metric === picked) : undefined);
	const clock = $derived(
		updated ? new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
	);

	function arrow(delta: number): string {
		return delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
	}

	function selectTab(event: KeyboardEvent, index: number) {
		const ids = [...tabs.map((item) => item.id), ALL];
		const next =
			event.key === 'ArrowRight' ? (index + 1) % ids.length : event.key === 'ArrowLeft' ? (index - 1 + ids.length) % ids.length : -1;
		if (next < 0) return;
		event.preventDefault();
		ontab?.(ids[next]);
		document.getElementById(`dash-tab-${ids[next]}`)?.focus();
	}
</script>

<h1>Dashboard</h1>

<div class="toolbar">
	<div class="group" role="group" aria-label="Period">
		{#each PERIODS as item (item.id)}
			<button
				type="button"
				aria-pressed={!isCustom(range) && range.period === item.id}
				onclick={() => {
					customOpen = false;
					onrange?.({ period: item.id });
				}}>{item.label}</button
			>
		{/each}
		<button type="button" aria-pressed={isCustom(range)} aria-expanded={customOpen} onclick={openCustom}
			>Custom range</button
		>
	</div>
	<label class="node">
		<span>Node</span>
		<select
			value={node === null ? 'all' : String(node)}
			onchange={(event) => onnode?.(event.currentTarget.value === 'all' ? null : Number(event.currentTarget.value))}
		>
			<option value="all">All nodes</option>
			{#each stats?.nodeList ?? [] as info (info.id)}
				<option value={String(info.id)}>{info.hostname || 'Node'} (node {info.id})</option>
			{/each}
		</select>
	</label>
	<div class="group" role="group" aria-label="Chart style">
		<button type="button" aria-pressed={mode === 'bars'} onclick={() => onmode?.('bars')}>Bars</button>
		<button type="button" aria-pressed={mode === 'lines'} onclick={() => onmode?.('lines')}>Lines</button>
	</div>
	<div class="meta">
		{#if stats}
			<span>{stats.nodes === 1 ? '1 node' : `${stats.nodes} nodes`}</span>
		{/if}
		{#if clock}<span>Updated {clock}</span>{/if}
		{#if loading && stats}<span role="status">Loading…</span>{/if}
		<button type="button" class="refresh" onclick={() => onrefresh?.()}>Refresh</button>
	</div>
</div>

{#if customOpen}
	<form class="custom" onsubmit={applyCustom} aria-label="Custom range">
		<label><span>From</span><input type="datetime-local" bind:value={fromText} /></label>
		<label><span>To</span><input type="datetime-local" bind:value={toText} /></label>
		<button type="submit">Show range</button>
		{#if customError}<p class="error" role="alert">{customError}</p>{/if}
	</form>
{/if}
{#if isCustom(range)}
	<p class="desc">Showing {periodLabel}.</p>
{/if}
{#if status === 'invalid'}
	<p class="error" role="alert">{message || 'That range cannot be shown.'}</p>
{/if}

{#if status === 'signed-out'}
	<p class="notice"><a href="/login">Sign in</a> to see server statistics.</p>
{:else if status === 'forbidden'}
	<p class="notice" role="status">Only administrators can see server statistics.</p>
{:else if !stats && status === 'failed'}
	<p class="notice" role="status">
		Could not load statistics. <button type="button" onclick={() => onrefresh?.()}>Try again</button>
	</p>
{:else if !stats}
	<p class="notice" role="status">Loading statistics…</p>
{/if}

{#if stats}
	{#if status === 'failed'}
		<p class="notice" role="status">Could not refresh. These are the last figures loaded.</p>
	{/if}
	{#if stats.since === null}
		<p class="notice">
			No history yet. The server stores statistics once a minute, so bars appear a few minutes after
			mail starts moving. Live figures are already current.
		</p>
	{/if}

	<div class="tabs" role="tablist" aria-label="Dashboard sections">
		{#each tabs as item, index (item.id)}
			<button
				type="button"
				role="tab"
				id="dash-tab-{item.id}"
				aria-selected={current?.id === item.id}
				aria-controls="dash-panel"
				tabindex={current?.id === item.id ? 0 : -1}
				onclick={() => ontab?.(item.id)}
				onkeydown={(event) => selectTab(event, index)}>{item.label}</button
			>
		{/each}
		<button
			type="button"
			role="tab"
			id="dash-tab-{ALL}"
			aria-selected={!current}
			aria-controls="dash-panel"
			tabindex={!current ? 0 : -1}
			onclick={() => ontab?.(ALL)}
			onkeydown={(event) => selectTab(event, tabs.length)}>All metrics</button
		>
	</div>

	<div id="dash-panel" role="tabpanel" aria-labelledby="dash-tab-{current?.id ?? ALL}" class="panel">
		{#if current}
			<div class="cards">
				{#each current.cards as card (card.title)}
					{@const value = cardValue(card, stats)}
					{@const delta = card.delta ? deltaPercent(value, cardPrevious(card, stats)) : null}
					<section class="card" aria-label={card.title}>
						<header>
							<h2>{card.title}</h2>
							<span class="badge">{card.source === 'live' ? 'Now' : badge}</span>
						</header>
						<p class="value">{formatValue(value, card.format)}</p>
						{#if delta !== null}
							<p class="delta">{arrow(delta)} {Math.abs(delta).toFixed(0)}% vs the period before</p>
						{/if}
						{#if card.sparkline}
							<BarChart
								compact
								{labels}
								format={card.format}
								series={[{ label: card.title, values: combine(stats, card.metrics, card.aggregate) }]}
							/>
						{/if}
						{#if card.description}<p class="desc">{card.description}</p>{/if}
					</section>
				{/each}
			</div>
			<div class="charts">
				{#each current.charts as chart (chart.title)}
					<section class="chart-card" aria-label={chart.title}>
						<h2>{chart.title}</h2>
						{#if chart.description}<p class="desc">{chart.description}</p>{/if}
						<BarChart
							title={chart.title}
							{labels}
							{mode}
							stacked={chart.stacked}
							format={chart.format}
							series={chartSeries(chart, stats)}
						/>
					</section>
				{/each}
			</div>
		{:else}
			<div class="explorer">
				<label class="filter">
					<span>Filter metrics</span>
					<input type="search" bind:value={filter} placeholder="auth, delivery, spam…" />
				</label>
				<p class="desc">
					{rows.length} {rows.length === 1 ? 'metric' : 'metrics'} recorded in {isCustom(range) ? 'this range' : 'the ' + periodLabel}.
				</p>
				{#if pickedSeries && picked}
					<section class="chart-card" aria-label={picked}>
						<h2>{picked}</h2>
						{#if pickedRow?.description}<p class="desc">{pickedRow.description}</p>{/if}
						<BarChart
							title={picked}
							{labels}
							{mode}
							format={pickedRow?.format ?? 'number'}
							series={[{ label: picked, values: pickedSeries.values }]}
						/>
					</section>
				{/if}
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">Metric</th>
								<th scope="col">This period</th>
								<th scope="col">Period before</th>
								<th scope="col"><span class="sr">Chart</span></th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row (row.metric)}
								<tr aria-current={picked === row.metric ? 'true' : undefined}>
									<th scope="row">
										<span class="name">{row.metric}</span>
										{#if row.description}<span class="desc">{row.description}</span>{/if}
									</th>
									<td>{formatValue(row.total, row.format)}{row.kind === 'average' ? ' avg' : ''}</td>
									<td>{formatValue(row.previous, row.format)}</td>
									<td>
										<button type="button" onclick={() => (picked = picked === row.metric ? null : row.metric)}>
											{picked === row.metric ? 'Hide' : 'Chart'}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	h1, h2, p { margin: 0; }
	h2 { font-size: 1rem; }
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--y-2xs) var(--x-s);
	}
	.group { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-color: transparent;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--x-2xs);
		margin-inline-start: auto;
		color: var(--color-muted);
	}
	.notice { color: var(--color-muted); }
	.error { color: var(--color-text); font-weight: 600; }
	.node, .custom label { display: grid; gap: 0.25rem; }
	.node span, .custom span { color: var(--color-muted); font-size: 0.875rem; }
	select, .custom input {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
	}
	.custom {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--y-2xs) var(--x-s);
	}
	.notice button { min-height: 2rem; }
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--x-2xs);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--y-2xs);
	}
	.tabs button[aria-selected='true'] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-color: transparent;
	}
	.panel { display: grid; gap: var(--y-s); }
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
		gap: var(--x-s);
	}
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
		gap: var(--x-s);
	}
	.card, .chart-card {
		display: grid;
		gap: var(--y-2xs);
		align-content: start;
		padding: var(--y-s) var(--x-s);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		min-width: 0;
	}
	.card header {
		display: flex;
		justify-content: space-between;
		gap: var(--x-2xs);
		align-items: baseline;
	}
	.badge { color: var(--color-muted); font-size: 0.8125rem; white-space: nowrap; }
	.value {
		font-size: 1.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}
	.delta { color: var(--color-muted); font-size: 0.875rem; font-variant-numeric: tabular-nums; }
	.desc { color: var(--color-muted); font-size: 0.875rem; }
	.explorer { display: grid; gap: var(--y-2xs); }
	.filter { display: grid; gap: 0.25rem; max-width: 24rem; }
	.filter input {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
	}
	.scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
	th, td {
		padding: 0.375rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		text-align: end;
		vertical-align: top;
	}
	th[scope='row'], thead th:first-child { text-align: start; }
	th[scope='row'] { display: grid; gap: 0.125rem; font-weight: normal; }
	.name { font-family: ui-monospace, monospace; font-size: 0.875rem; }
	tr[aria-current='true'] { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	td button { min-height: 2rem; }
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
