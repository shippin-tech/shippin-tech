import { describe, expect, it } from 'vitest';
import {
	barLabels,
	cardPrevious,
	cardValue,
	chartSeries,
	classifyStats,
	combine,
	coversPrevious,
	deltaPercent,
	formatValue,
	fromLocalInput,
	isCustom,
	metricFormat,
	metricRows,
	niceScale,
	niceScaleFor,
	parseStats,
	statsUrl,
	toLocalInput,
	type DashboardCard,
	type DashboardChart,
	type Stats
} from '../src/lib/shippin/dashboard/stats-call';
import { dashboards } from '../src/lib/portal/catalog';

const HOUR = 3600;

function sample(overrides: Partial<Stats> = {}): Stats {
	return {
		period: '24h',
		start: 1_762_732_800, // 2025-11-10 00:00 UTC
		step: HOUR,
		points: 3,
		since: 1_762_732_800 - 3 * HOUR,
		node: null,
		nodes: 1,
		nodeList: [{ id: 1, hostname: 'mail.test' }],
		live: { 'user.count': 4, 'server.memory': 1024 * 1024 * 300, 'smtp.active-connections': 2 },
		history: {
			'queue.message-queued': { kind: 'count', values: [1, 0, 4], total: 5, previous: 10 },
			'queue.dsn-queued': { kind: 'count', values: [0, 2, 0], total: 2, previous: 0 },
			'delivery.total-time': { kind: 'average', values: [null, 1500, 500], total: 1000, previous: 800 }
		},
		descriptions: { 'queue.message-queued': 'Messages queued', 'delivery.total-time': 'Delivery time' },
		...overrides
	};
}

function card(overrides: Partial<DashboardCard>): DashboardCard {
	return {
		title: 'Card',
		icon: '',
		source: 'history',
		metrics: [],
		aggregate: 'sum',
		format: 'number',
		description: '',
		sparkline: false,
		delta: false,
		...overrides
	};
}

describe('dashboard statistics', () => {
	it('classifies responses', () => {
		expect([200, 400, 401, 403, 500].map(classifyStats)).toEqual(['ready', 'invalid', 'signed-out', 'forbidden', 'failed']);
	});

	it('accepts the server payload and rejects broken ones', () => {
		const body = JSON.parse(JSON.stringify(sample()));
		expect(parseStats(body).history['queue.message-queued'].total).toBe(5);
		expect(parseStats({ ...body, since: null }).since).toBeNull();
		expect(parseStats({ ...body, period: 'custom', node: 2 })).toMatchObject({ period: 'custom', node: 2 });
		expect(parseStats(body).nodeList).toEqual([{ id: 1, hostname: 'mail.test' }]);
		expect(() => parseStats({ ...body, nodeList: [{ id: 'one' }] })).toThrow();
		expect(() => parseStats({ ...body, period: '1y' })).toThrow();
		expect(() => parseStats({ ...body, step: 0 })).toThrow();
		expect(() =>
			parseStats({ ...body, history: { x: { kind: 'count', values: [1], total: 1, previous: 0 } } })
		).toThrow();
		expect(() => parseStats({ ...body, live: { 'user.count': 'four' } })).toThrow();
	});

	it('combines metrics per bar', () => {
		const stats = sample();
		expect(combine(stats, ['queue.message-queued', 'queue.dsn-queued'], 'sum')).toEqual([1, 2, 4]);
		expect(combine(stats, ['never.recorded'], 'sum')).toEqual([0, 0, 0]);
		expect(combine(stats, ['delivery.total-time'], 'avg')).toEqual([null, 1500, 500]);
		expect(combine(stats, ['never.recorded'], 'avg')).toEqual([null, null, null]);
	});

	it('computes card values and period-over-period changes', () => {
		const stats = sample();
		const sent = card({ metrics: ['queue.message-queued', 'queue.dsn-queued'], delta: true });
		expect(cardValue(sent, stats)).toBe(7);
		expect(cardPrevious(sent, stats)).toBe(10);
		expect(deltaPercent(7, 10)).toBeCloseTo(-30);
		expect(deltaPercent(7, 0)).toBeNull();

		const timing = card({ metrics: ['delivery.total-time'], aggregate: 'avg', format: 'duration' });
		expect(cardValue(timing, stats)).toBe(1000);
		expect(cardValue(card({ metrics: ['nothing'], aggregate: 'avg' }), stats)).toBeNull();
		expect(cardValue(card({ metrics: ['nothing'] }), stats)).toBe(0);

		const users = card({ source: 'live', metrics: ['user.count'] });
		expect(cardValue(users, stats)).toBe(4);
		expect(cardPrevious(users, stats)).toBeNull();
		expect(cardValue(card({ source: 'live', metrics: ['queue.count'] }), stats)).toBeNull();
	});

	it('hides comparisons until history covers the period before', () => {
		const young = sample({ since: 1_762_732_800 - HOUR });
		expect(coversPrevious(young)).toBe(false);
		expect(cardPrevious(card({ metrics: ['queue.message-queued'] }), young)).toBeNull();
		expect(metricRows(young)[0].previous).toBeNull();
		expect(coversPrevious(sample({ since: null }))).toBe(false);
	});

	it('builds chart series from the definition', () => {
		const chart: DashboardChart = {
			title: 'Messages',
			kind: 'area',
			stacked: true,
			format: 'number',
			description: '',
			series: [
				{ label: 'received', metrics: ['queue.message-queued'], aggregate: 'sum' },
				{ label: 'sent', metrics: ['queue.dsn-queued'], aggregate: 'sum' }
			]
		};
		expect(chartSeries(chart, sample())).toEqual([
			{ label: 'received', values: [1, 0, 4] },
			{ label: 'sent', values: [0, 2, 0] }
		]);
	});

	it('formats numbers, bytes and durations', () => {
		expect(formatValue(null, 'number')).toBe('–');
		expect(formatValue(1234, 'number')).toBe('1,234');
		expect(formatValue(12_345, 'number')).toBe('12.3K');
		expect(formatValue(2.5, 'number')).toBe('2.5');
		expect(formatValue(1024 * 1024 * 300, 'bytes')).toBe('300 MB');
		expect(formatValue(1536, 'bytes')).toBe('1.5 KB');
		expect(formatValue(12, 'duration')).toBe('12 ms');
		expect(formatValue(1500, 'duration')).toBe('1.5 s');
		expect(formatValue(90_000, 'duration')).toBe('1.5 min');
		expect(metricFormat('server.memory')).toBe('bytes');
		expect(metricFormat('message.size')).toBe('bytes');
		expect(metricFormat('store.data-read-time')).toBe('duration');
		expect(metricFormat('auth.failed')).toBe('number');
	});

	it('labels bars by hour, six hours or day', () => {
		expect(barLabels(sample(), 'UTC')).toEqual(['00:00', '01:00', '02:00']);
		expect(barLabels(sample({ step: 6 * HOUR }), 'UTC')).toEqual(['Mon 00:00', 'Mon 06:00', 'Mon 12:00']);
		expect(barLabels(sample({ step: 86_400 }), 'UTC')).toEqual(['Nov 10', 'Nov 11', 'Nov 12']);
		expect(barLabels(sample({ points: 30 }), 'UTC').slice(23, 25)).toEqual(['Mon 23:00', 'Tue 00:00']);
	});

	it('asks for presets, custom ranges and single nodes', () => {
		expect(statsUrl({ period: '7d' }, null)).toBe('/api/stats?period=7d');
		expect(statsUrl({ from: 100.7, to: 200 }, 3)).toBe('/api/stats?from=100&to=200&node=3');
		expect(isCustom({ from: 1, to: 2 })).toBe(true);
		expect(isCustom({ period: '24h' })).toBe(false);
		const now = Math.floor(Date.now() / 60_000) * 60;
		expect(fromLocalInput(toLocalInput(now))).toBe(now);
		expect(fromLocalInput('')).toBeNull();
		expect(fromLocalInput('yesterday')).toBeNull();
	});

	it('picks round axis tops', () => {
		expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
		expect(niceScale(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
		expect(niceScale(930).max).toBe(1000);
		expect(niceScale(1_000_000_000).ticks.at(-1)).toBe(niceScale(1_000_000_000).max);
		const memory = niceScaleFor(83_206_144, 'bytes');
		expect(memory.ticks.map((tick) => formatValue(tick, 'bytes'))).toEqual(['0 B', '20 MB', '40 MB', '60 MB', '80 MB']);
		expect(niceScaleFor(7, 'number')).toEqual(niceScale(7));
	});

	it('lists every recorded metric for the All metrics tab', () => {
		const rows = metricRows(sample());
		expect(rows.map((row) => row.metric)).toEqual([
			'delivery.total-time',
			'queue.dsn-queued',
			'queue.message-queued'
		]);
		expect(rows[0]).toMatchObject({ kind: 'average', format: 'duration', total: 1000, previous: 800 });
		expect(metricRows(sample(), 'delivery').map((row) => row.metric)).toEqual(['delivery.total-time']);
		expect(metricRows(sample(), 'messages queued').map((row) => row.metric)).toEqual(['queue.message-queued']);
	});

	it('carries the whole dashboard definition from the schema', () => {
		expect(dashboards.map((tab) => tab.id)).toEqual([
			'overview',
			'network',
			'security',
			'delivery',
			'performance',
			'storage'
		]);
		for (const tab of dashboards) {
			expect(tab.cards.length).toBeGreaterThan(0);
			expect(tab.charts.length).toBeGreaterThan(0);
			for (const item of tab.cards) expect(item.metrics.length).toBeGreaterThan(0);
			for (const chart of tab.charts) {
				expect(chart.series.length).toBeGreaterThan(0);
				expect(chart.series.length).toBeLessThanOrEqual(4);
			}
		}
		expect(JSON.stringify(dashboards)).not.toContain('ShippinTECH');
	});
});
