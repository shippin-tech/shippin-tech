/**
 * Proves dashboard metrics follow the live stream and do not invent numbers.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-metrics.ts
 */
import { readFileSync } from 'node:fs';
import {
	cardCounts,
	chartPoints,
	metricsData,
	metricsFailure,
	metricsStreamUrl,
	parseMetricsPayload,
	reduceMetricsStream
} from '../src/lib/adapter/metrics-call.ts';

const frame = [
	'event: metrics',
	'data: [{"metric":"user.count","@type":"Gauge","count":4},{"metric":"domain.count","@type":"Gauge","count":2},{"metric":"queue.count","@type":"Counter","count":1},{"metric":"delivery.time","@type":"Histogram","count":3,"sum":9}]',
	''
].join('\n');

const samples = parseMetricsPayload(metricsData(frame));
if (samples.length !== 4) throw new Error('samples ' + samples.length);
if (samples[3].type !== 'Histogram' || samples[3].sum !== 9) throw new Error('histogram');
const counts = cardCounts(samples);
if (counts['Total Users'] !== 4 || counts['Total Domains'] !== 2 || counts['Pending Messages'] !== 1) {
	throw new Error('cards ' + JSON.stringify(counts));
}
if ('Server Memory' in counts || 'Received Messages' in counts || 'Sent Messages' in counts) {
	throw new Error('invented card');
}
const points = chartPoints(samples);
if (points.length !== 1 || points[0].count !== 4) throw new Error('points');
if (chartPoints([]).length !== 0) throw new Error('empty chart');

let rejected = false;
try {
	parseMetricsPayload('[{"metric":"delivery.time","@type":"Histogram","count":1}]');
} catch {
	rejected = true;
}
if (!rejected) throw new Error('histogram without sum');

if (metricsStreamUrl('', ['user.count']) !== '') throw new Error('empty token opens a stream');
const url = metricsStreamUrl('token-1', ['user.count', 'domain.count']);
if (!url.startsWith('/api/live/metrics?') || !url.includes('token=token-1') || !url.includes('interval=30')) {
	throw new Error('url ' + url);
}

let state = reduceMetricsStream({ kind: 'idle' }, { type: 'connect' });
for (let attempt = 0; attempt < 5; attempt += 1) {
	state = reduceMetricsStream(state, { type: 'error', retryable: true, reason: 'retries' });
	if (state.kind !== 'reconnecting') throw new Error('retry ' + attempt + ' ' + state.kind);
	if (attempt === 0 && state.delayMs !== 2000) throw new Error('delay ' + state.delayMs);
	state = reduceMetricsStream(state, { type: 'retry' });
}
state = reduceMetricsStream(state, { type: 'error', retryable: true, reason: 'retries' });
if (state.kind !== 'failed' || metricsFailure(state.reason) !== 'Live metrics stream disconnected after multiple retries.') {
	throw new Error('disconnect');
}
if (metricsFailure('rejected') !== 'The server refused the live metrics stream.') throw new Error('refused copy');

const panel = readFileSync(new URL('../src/lib/catalog/portal/DashboardPanel.svelte', import.meta.url), 'utf8');
const chart = readFileSync(new URL('../src/lib/catalog/portal/MetricsChart.svelte', import.meta.url), 'utf8');
const dash = readFileSync(new URL('../src/routes/(portal)/portal/Dashboard.svelte', import.meta.url), 'utf8');
for (const sentence of [
	'The server refused the live metrics stream.',
	'Failed to connect to live metrics.',
	'Live metrics stream disconnected after multiple retries.',
	'No data'
]) {
	if (!panel.includes(sentence)) throw new Error('missing ' + sentence);
}
if (!panel.includes('points.length > 0') || !chart.includes("import('layerchart')")) throw new Error('chart gate');
if (panel.includes("from '$lib/adapter") || chart.includes("from '$lib/adapter")) throw new Error('catalog fetches');
if (!dash.includes('metricsStreamUrl') || !dash.includes("next.status !== 'ready'")) throw new Error('route opens without a token');

console.log('ok');
