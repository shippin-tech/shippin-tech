/**
 * Pure helpers for the portal dashboard. The data comes from our own
 * `GET /api/stats` (crates/common/src/shippin/stats.rs); the tabs, cards and charts
 * come from the schema's dashboard definition (catalog.ts `dashboards`).
 */

export type StatsPeriod = '24h' | '7d' | '30d' | '90d';
export type StatsStatus = 'signed-out' | 'forbidden' | 'invalid' | 'failed' | 'ready';
export type ValueFormat = 'number' | 'bytes' | 'duration';
export type Aggregate = 'sum' | 'avg';

export const PERIODS: readonly { id: StatsPeriod; label: string }[] = [
	{ id: '24h', label: 'Last 24 hours' },
	{ id: '7d', label: 'Last 7 days' },
	{ id: '30d', label: 'Last 30 days' },
	{ id: '90d', label: 'Last 90 days' }
];

export type StatsSeries = {
	kind: 'count' | 'average';
	values: (number | null)[];
	total: number | null;
	previous: number | null;
};

/** A preset period ending now, or any range in seconds since 1970. */
export type StatsRange = { period: StatsPeriod } | { from: number; to: number };

export type NodeInfo = { id: number; hostname: string };

export type Stats = {
	period: StatsPeriod | 'custom';
	start: number;
	step: number;
	points: number;
	since: number | null;
	node: number | null;
	nodes: number;
	nodeList: NodeInfo[];
	live: Record<string, number>;
	history: Record<string, StatsSeries>;
	descriptions: Record<string, string>;
};

export type DashboardCard = {
	readonly title: string;
	readonly icon: string;
	readonly source: 'live' | 'history';
	readonly metrics: readonly string[];
	readonly aggregate: Aggregate;
	readonly format: ValueFormat;
	readonly description: string;
	readonly sparkline: boolean;
	readonly delta: boolean;
};

export type DashboardSeries = {
	readonly label: string;
	readonly metrics: readonly string[];
	readonly aggregate: Aggregate;
};

export type DashboardChart = {
	readonly title: string;
	readonly kind: 'bar' | 'line' | 'area';
	readonly stacked: boolean;
	readonly format: ValueFormat;
	readonly description: string;
	readonly series: readonly DashboardSeries[];
};

export type DashboardTab = {
	readonly id: string;
	readonly label: string;
	readonly cards: readonly DashboardCard[];
	readonly charts: readonly DashboardChart[];
};

export type ChartSeries = { label: string; values: (number | null)[] };

export function isPeriod(value: unknown): value is StatsPeriod {
	return value === '24h' || value === '7d' || value === '30d' || value === '90d';
}

export function isCustom(range: StatsRange): range is { from: number; to: number } {
	return 'from' in range;
}

/** The request for a range and node (null means all nodes). */
export function statsUrl(range: StatsRange, node: number | null): string {
	const params = new URLSearchParams();
	if (isCustom(range)) {
		params.set('from', String(Math.floor(range.from)));
		params.set('to', String(Math.floor(range.to)));
	} else {
		params.set('period', range.period);
	}
	if (node !== null) params.set('node', String(node));
	return `/api/stats?${params.toString()}`;
}

/** Seconds since 1970 to a `datetime-local` input value, in the viewer's time zone. */
export function toLocalInput(seconds: number): string {
	const at = new Date(seconds * 1000);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A `datetime-local` input value to seconds since 1970, or null. */
export function fromLocalInput(value: string): number | null {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
	const ms = new Date(value).getTime();
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function isNode(value: unknown): value is NodeInfo {
	if (!value || typeof value !== 'object') return false;
	const node = value as Record<string, unknown>;
	return isNumber(node.id) && typeof node.hostname === 'string';
}

export function classifyStats(status: number): StatsStatus {
	if (status === 200) return 'ready';
	if (status === 401) return 'signed-out';
	if (status === 403) return 'forbidden';
	if (status === 400) return 'invalid';
	return 'failed';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecordOf<T>(value: unknown, check: (item: unknown) => item is T): value is Record<string, T> {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(check);
}

function isSeries(value: unknown): value is StatsSeries {
	if (!value || typeof value !== 'object') return false;
	const series = value as Record<string, unknown>;
	return (
		(series.kind === 'count' || series.kind === 'average') &&
		Array.isArray(series.values) &&
		series.values.every((item) => item === null || isNumber(item)) &&
		(series.total === null || isNumber(series.total)) &&
		(series.previous === null || isNumber(series.previous))
	);
}

/** Checks the server's answer; throws on anything unexpected. */
export function parseStats(body: unknown): Stats {
	if (!body || typeof body !== 'object') throw new TypeError('Unexpected statistics payload');
	const raw = body as Record<string, unknown>;
	if (
		!(isPeriod(raw.period) || raw.period === 'custom') ||
		!isNumber(raw.start) ||
		!isNumber(raw.step) ||
		raw.step <= 0 ||
		!isNumber(raw.points) ||
		!(raw.since === null || raw.since === undefined || isNumber(raw.since)) ||
		!isNumber(raw.nodes) ||
		!(raw.node === null || raw.node === undefined || isNumber(raw.node)) ||
		!(raw.nodeList === undefined || (Array.isArray(raw.nodeList) && raw.nodeList.every(isNode))) ||
		!isRecordOf(raw.live, isNumber) ||
		!isRecordOf(raw.history, isSeries) ||
		!isRecordOf(raw.descriptions, (item): item is string => typeof item === 'string')
	) {
		throw new TypeError('Unexpected statistics payload');
	}
	const points = raw.points;
	for (const series of Object.values(raw.history)) {
		if (series.values.length !== points) throw new TypeError('Unexpected statistics payload');
	}
	return {
		period: raw.period,
		start: raw.start,
		step: raw.step,
		points,
		since: isNumber(raw.since) ? raw.since : null,
		node: isNumber(raw.node) ? raw.node : null,
		nodes: raw.nodes,
		nodeList: Array.isArray(raw.nodeList) ? (raw.nodeList as NodeInfo[]) : [],
		live: raw.live,
		history: raw.history,
		descriptions: raw.descriptions
	};
}

function mean(values: number[]): number | null {
	return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

/**
 * One value per bar for a set of metrics. Sums add counts (a metric with no
 * history had no events, so it adds nothing); averages take the mean of the
 * metrics that observed something in that bar.
 */
export function combine(stats: Stats, metrics: readonly string[], aggregate: Aggregate): (number | null)[] {
	return Array.from({ length: stats.points }, (_, bar) => {
		const values = metrics.flatMap((metric) => {
			const value = stats.history[metric]?.values[bar];
			return value === null || value === undefined ? [] : [value];
		});
		if (aggregate === 'sum') return values.reduce((total, value) => total + value, 0);
		return mean(values);
	});
}

function fold(values: (number | null | undefined)[], aggregate: Aggregate, missing: number | null): number | null {
	const present = values.map((value) => (value === undefined ? missing : value)).filter(isNumber);
	if (aggregate === 'sum') return present.length || missing !== null ? present.reduce((a, b) => a + b, 0) : null;
	return mean(present);
}

/** The headline number of a card. */
export function cardValue(card: DashboardCard, stats: Stats): number | null {
	if (card.source === 'live') {
		return fold(card.metrics.map((metric) => stats.live[metric]), card.aggregate, null);
	}
	return fold(
		card.metrics.map((metric) => stats.history[metric]?.total),
		card.aggregate,
		card.aggregate === 'sum' ? 0 : null
	);
}

/** True when stored history reaches back over the whole previous period. */
export function coversPrevious(stats: Stats): boolean {
	return stats.since !== null && stats.since <= stats.start - stats.step * stats.points;
}

/** The same card over the period before, or null when history does not reach back. */
export function cardPrevious(card: DashboardCard, stats: Stats): number | null {
	if (card.source === 'live' || !coversPrevious(stats)) return null;
	return fold(
		card.metrics.map((metric) => stats.history[metric]?.previous),
		card.aggregate,
		card.aggregate === 'sum' ? 0 : null
	);
}

/** Percentage change, or null when there is nothing to compare against. */
export function deltaPercent(current: number | null, previous: number | null): number | null {
	if (current === null || previous === null || previous === 0) return null;
	return ((current - previous) / previous) * 100;
}

export function chartSeries(chart: DashboardChart, stats: Stats): ChartSeries[] {
	return chart.series.map((series) => ({
		label: series.label,
		values: combine(stats, series.metrics, series.aggregate)
	}));
}

function trim(value: number): string {
	return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, '') : value.toFixed(2).replace(/\.?0+$/, '');
}

export function formatValue(value: number | null, format: ValueFormat): string {
	if (value === null || !Number.isFinite(value)) return '–';
	if (format === 'bytes') {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let size = Math.abs(value);
		let unit = 0;
		while (size >= 1024 && unit < units.length - 1) {
			size /= 1024;
			unit += 1;
		}
		return `${value < 0 ? '-' : ''}${trim(size)} ${units[unit]}`;
	}
	if (format === 'duration') {
		const ms = Math.abs(value);
		const sign = value < 0 ? '-' : '';
		if (ms < 1000) return `${sign}${trim(ms)} ms`;
		if (ms < 60_000) return `${sign}${trim(ms / 1000)} s`;
		if (ms < 3_600_000) return `${sign}${trim(ms / 60_000)} min`;
		return `${sign}${trim(ms / 3_600_000)} h`;
	}
	if (Math.abs(value) >= 10_000) {
		return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
	}
	return Number.isInteger(value) ? value.toLocaleString('en') : trim(value);
}

/** Guesses how to show a metric that no card describes (the "All metrics" tab). */
export function metricFormat(metric: string): ValueFormat {
	if (metric === 'server.memory' || metric.endsWith('-size') || metric.endsWith('.size')) return 'bytes';
	if (metric.endsWith('-time') || metric.endsWith('.time')) return 'duration';
	return 'number';
}

/** A label for each bar, in the viewer's time zone unless one is given. */
export function barLabels(stats: Stats, timeZone?: string): string[] {
	const time = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
	const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone });
	const dayTime = new Intl.DateTimeFormat('en', { weekday: 'short', hour: '2-digit', hour12: false, timeZone });
	const withDay = stats.step >= 6 * 3600 || stats.step * stats.points > 86_400;
	return Array.from({ length: stats.points }, (_, bar) => {
		const at = new Date((stats.start + bar * stats.step) * 1000);
		if (stats.step >= 86_400) return day.format(at);
		if (!withDay) return time.format(at);
		const parts = dayTime.formatToParts(at);
		const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
		return `${part('weekday')} ${part('hour')}:00`;
	});
}

export type MetricRow = {
	metric: string;
	description: string;
	kind: 'count' | 'average';
	format: ValueFormat;
	total: number | null;
	previous: number | null;
};

/** Every metric with stored history in the period, for the "All metrics" tab. */
export function metricRows(stats: Stats, filter = ''): MetricRow[] {
	const needle = filter.trim().toLowerCase();
	return Object.entries(stats.history)
		.map(([metric, series]) => ({
			metric,
			description: stats.descriptions[metric] ?? '',
			kind: series.kind,
			format: series.kind === 'count' ? ('number' as const) : metricFormat(metric),
			total: series.total,
			previous: coversPrevious(stats) ? series.previous : null
		}))
		.filter((row) => !needle || row.metric.includes(needle) || row.description.toLowerCase().includes(needle))
		.sort((a, b) => a.metric.localeCompare(b.metric));
}

/** A round top for the y axis and evenly spaced ticks up to it. */
export function niceScale(max: number, ticks = 4): { max: number; ticks: number[] } {
	if (!Number.isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] };
	const rough = max / ticks;
	const power = 10 ** Math.floor(Math.log10(rough));
	const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
	const top = Math.ceil(max / step) * step;
	return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step) };
}

/** Like niceScale, but byte axes get round numbers in the unit they are shown in (25 MB, not 23.8 MB). */
export function niceScaleFor(max: number, format: ValueFormat): { max: number; ticks: number[] } {
	if (format !== 'bytes' || !Number.isFinite(max) || max < 1024) return niceScale(max);
	let unit = 1;
	while (max / unit >= 1024 && unit < 1024 ** 4) unit *= 1024;
	const scaled = niceScale(max / unit);
	return { max: scaled.max * unit, ticks: scaled.ticks.map((tick) => tick * unit) };
}
