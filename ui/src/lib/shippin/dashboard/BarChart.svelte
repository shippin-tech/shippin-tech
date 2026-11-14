<script lang="ts">
	import { formatValue, niceScaleFor, type ChartSeries, type ValueFormat } from '$lib/shippin/dashboard/stats-call';

	let {
		series,
		labels,
		stacked = false,
		mode = 'bars',
		format = 'number',
		compact = false,
		title = ''
	}: {
		series: readonly ChartSeries[];
		labels: readonly string[];
		stacked?: boolean;
		mode?: 'bars' | 'lines';
		format?: ValueFormat;
		compact?: boolean;
		title?: string;
	} = $props();

	const GAP = 2;
	const MAX_BAR = 24;

	let width = $state(0);
	let active = $state<number | null>(null);

	const height = $derived(compact ? 40 : 220);
	const margin = $derived(
		compact ? { top: 2, right: 0, bottom: 2, left: 0 } : { top: 10, right: 8, bottom: 26, left: 60 }
	);
	const plotW = $derived(Math.max(0, width - margin.left - margin.right));
	const plotH = $derived(Math.max(0, height - margin.top - margin.bottom));
	const points = $derived(labels.length);
	const band = $derived(points ? plotW / points : 0);
	const stackBars = $derived(stacked && mode === 'bars' && series.length > 1);

	const peak = $derived.by(() => {
		let top = 0;
		for (let bar = 0; bar < points; bar++) {
			if (stackBars) {
				top = Math.max(top, series.reduce((total, item) => total + (item.values[bar] ?? 0), 0));
			} else {
				for (const item of series) top = Math.max(top, item.values[bar] ?? 0);
			}
		}
		return top;
	});
	const scale = $derived(niceScaleFor(peak, format));
	const empty = $derived(series.every((item) => item.values.every((value) => !value)));

	function y(value: number): number {
		return margin.top + plotH - (value / scale.max) * plotH;
	}

	function center(bar: number): number {
		return margin.left + band * (bar + 0.5);
	}

	function barPath(x: number, top: number, bottom: number, w: number, round: boolean): string {
		const h = bottom - top;
		if (h <= 0 || w <= 0) return '';
		const r = round ? Math.min(4, w / 2, h) : 0;
		if (!r) return `M${x},${bottom}V${top}H${x + w}V${bottom}Z`;
		return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
	}

	type Mark = { key: string; d: string; slot: number; bar: number };

	const marks = $derived.by((): Mark[] => {
		if (mode !== 'bars' || !band || !plotH) return [];
		const gap = band > 6 ? GAP : band > 3 ? 1 : 0;
		const out: Mark[] = [];
		const baseline = y(0);
		if (stackBars || series.length === 1) {
			const w = Math.max(1, Math.min(MAX_BAR, band - gap));
			for (let bar = 0; bar < points; bar++) {
				const x = center(bar) - w / 2;
				const drawn = series.map((item, slot) => ({ slot, value: item.values[bar] ?? 0 })).filter((item) => item.value > 0);
				let base = 0;
				drawn.forEach((item, index) => {
					const bottom = base > 0 ? y(base) - gap : baseline;
					const top = y(base + item.value);
					base += item.value;
					const d = barPath(x, Math.min(top, bottom - 0.5), bottom, w, index === drawn.length - 1);
					if (d) out.push({ key: `${bar}-${item.slot}`, d, slot: item.slot, bar });
				});
			}
			return out;
		}
		const count = series.length;
		const group = Math.max(count, Math.min(band - gap * 2, MAX_BAR * count + gap * (count - 1)));
		const w = Math.max(1, (group - gap * (count - 1)) / count);
		for (let bar = 0; bar < points; bar++) {
			const left = center(bar) - group / 2;
			series.forEach((item, slot) => {
				const value = item.values[bar] ?? 0;
				if (value <= 0) return;
				const d = barPath(left + slot * (w + gap), Math.min(y(value), baseline - 0.5), baseline, w, true);
				if (d) out.push({ key: `${bar}-${slot}`, d, slot, bar });
			});
		}
		return out;
	});

	const lines = $derived.by(() => {
		if (mode !== 'lines' || !band) return [];
		return series.map((item, slot) => {
			let d = '';
			let pen = false;
			item.values.forEach((value, bar) => {
				if (value === null) {
					pen = false;
					return;
				}
				d += `${pen ? 'L' : 'M'}${center(bar)},${y(value)}`;
				pen = true;
			});
			return { slot, d };
		});
	});

	const xTicks = $derived.by(() => {
		if (compact || !points) return [];
		const every = Math.max(1, Math.ceil(points / Math.max(2, Math.floor(plotW / 90))));
		const picks: number[] = [];
		for (let bar = points - 1; bar >= 0; bar -= every) picks.unshift(bar);
		return picks;
	});

	function pick(clientX: number, target: Element) {
		const rect = target.getBoundingClientRect();
		const bar = Math.floor((clientX - rect.left - margin.left) / (band || 1));
		active = bar >= 0 && bar < points ? bar : null;
	}

	function keydown(event: KeyboardEvent) {
		if (!points) return;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const step = event.key === 'ArrowLeft' ? -1 : 1;
			active = Math.min(points - 1, Math.max(0, (active ?? points - 1) + step));
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			active = event.key === 'Home' ? 0 : points - 1;
		} else if (event.key === 'Escape') {
			active = null;
		}
	}

	const readout = $derived.by(() => {
		if (active === null || compact) return null;
		const bar = active;
		const rows = series.map((item, slot) => ({ slot, label: item.label, value: item.values[bar] ?? null }));
		const total = stackBars ? rows.reduce((sum, row) => sum + (row.value ?? 0), 0) : null;
		return { bar, label: labels[bar] ?? '', rows, total };
	});
	const valueText = $derived.by(() => {
		const bar = active ?? points - 1;
		if (bar < 0) return 'No data';
		const parts = series.map((item) => `${item.label} ${formatValue(item.values[bar] ?? null, format)}`);
		return `${labels[bar] ?? ''}: ${parts.join(', ')}`;
	});
	const tipLeft = $derived(
		readout ? Math.min(Math.max(center(readout.bar), 90), Math.max(90, width - 90)) : 0
	);
</script>

{#snippet plot()}
	{#if !compact}
		{#each scale.ticks as tick (tick)}
			<line class="grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
			<text class="axis" x={margin.left - 8} y={y(tick)} text-anchor="end" dominant-baseline="middle">
				{formatValue(tick, format)}
			</text>
		{/each}
		{#each xTicks as bar (bar)}
			<text class="axis" x={center(bar)} y={height - 8} text-anchor="middle">{labels[bar]}</text>
		{/each}
		{#if active !== null}
			<rect
				class="column"
				x={margin.left + band * active}
				y={margin.top}
				width={Math.max(1, band)}
				height={plotH}
			/>
		{/if}
	{/if}
	{#each marks as mark (mark.key)}
		<path class="mark s{mark.slot}" d={mark.d} />
	{/each}
	{#each lines as line (line.slot)}
		<path class="line s{line.slot}" d={line.d} />
	{/each}
	{#if mode === 'lines' && active !== null}
		{#each series as item, slot (item.label)}
			{@const value = item.values[active]}
			{#if value !== null && value !== undefined}
				<circle class="dot s{slot}" cx={center(active)} cy={y(value)} r="4" />
			{/if}
		{/each}
	{/if}
{/snippet}

<div class="chart" class:compact bind:clientWidth={width}>
	{#if width > 0}
		{#if compact}
			<svg {width} {height} aria-hidden="true">{@render plot()}</svg>
		{:else}
			<div
				class="plot"
				role="slider"
				tabindex="0"
				aria-label="{title}, by time"
				aria-valuemin={0}
				aria-valuemax={Math.max(0, points - 1)}
				aria-valuenow={active ?? Math.max(0, points - 1)}
				aria-valuetext={valueText}
				onpointermove={(event) => pick(event.clientX, event.currentTarget)}
				onpointerleave={() => (active = null)}
				onfocus={() => (active = points ? points - 1 : null)}
				onblur={() => (active = null)}
				onkeydown={keydown}
			>
				<svg {width} {height} aria-hidden="true">{@render plot()}</svg>
			</div>
		{/if}
		{#if !compact && empty}
			<p class="empty">Nothing recorded in this period.</p>
		{/if}
		{#if readout}
			<div class="tip" style:left="{tipLeft}px" role="status">
				<strong>{readout.label}</strong>
				{#each readout.rows as row (row.label)}
					<span><i class="swatch s{row.slot}"></i>{row.label}: {formatValue(row.value, format)}</span>
				{/each}
				{#if readout.total !== null}
					<span class="total">Total: {formatValue(readout.total, format)}</span>
				{/if}
			</div>
		{/if}
	{/if}
</div>

{#if !compact}
	{#if series.length > 1}
		<ul class="legend">
			{#each series as item, slot (item.label)}
				<li><i class="swatch s{slot}"></i>{item.label}</li>
			{/each}
		</ul>
	{/if}
	<details class="table">
		<summary>Show as table</summary>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Time</th>
						{#each series as item (item.label)}<th scope="col">{item.label}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each labels as label, bar (bar)}
						<tr>
							<th scope="row">{label}</th>
							{#each series as item (item.label)}<td>{formatValue(item.values[bar] ?? null, format)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
{/if}

<style>
	.chart {
		/* Validated categorical slots 1-4 (light, dark): blue, orange, aqua, yellow. */
		--series-0: light-dark(#2a78d6, #3987e5);
		--series-1: light-dark(#eb6834, #d95926);
		--series-2: light-dark(#1baf7a, #199e70);
		--series-3: light-dark(#eda100, #c98500);
		position: relative;
		width: 100%;
		min-height: 220px;
	}
	.chart.compact {
		min-height: 40px;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.plot {
		touch-action: pan-y;
	}
	.plot:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
		border-radius: var(--radius);
	}
	.grid {
		stroke: var(--color-border);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	.axis {
		fill: var(--color-muted);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.column {
		fill: var(--color-border);
		opacity: 0.45;
	}
	.mark.s0, .dot.s0, .swatch.s0 { fill: var(--series-0); background: var(--series-0); }
	.mark.s1, .dot.s1, .swatch.s1 { fill: var(--series-1); background: var(--series-1); }
	.mark.s2, .dot.s2, .swatch.s2 { fill: var(--series-2); background: var(--series-2); }
	.mark.s3, .dot.s3, .swatch.s3 { fill: var(--series-3); background: var(--series-3); }
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.line.s0 { stroke: var(--series-0); }
	.line.s1 { stroke: var(--series-1); }
	.line.s2 { stroke: var(--series-2); }
	.line.s3 { stroke: var(--series-3); }
	.dot {
		stroke: var(--color-card);
		stroke-width: 2;
	}
	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 3px;
		margin-inline-end: 0.375rem;
		vertical-align: -0.0625rem;
	}
	.tip {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: grid;
		gap: 0.125rem;
		min-width: 9rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-card);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		white-space: nowrap;
		z-index: 2;
	}
	.tip .total {
		color: var(--color-muted);
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--color-muted);
		pointer-events: none;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--color-text);
		font-size: 0.875rem;
	}
	.table summary {
		cursor: pointer;
		color: var(--color-muted);
		font-size: 0.875rem;
	}
	.scroll {
		max-height: 16rem;
		overflow: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}
	th, td {
		padding: 0.25rem 0.5rem;
		text-align: end;
		border-bottom: 1px solid var(--color-border);
	}
	th:first-child {
		text-align: start;
	}
</style>
