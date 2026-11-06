/**
 * Proves the dashboard metrics slice.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-dashboard.ts
 */
import { readFileSync } from 'node:fs';
import { classifyMetrics } from '../src/lib/adapter/metrics-call.ts';

if (classifyMetrics(404) !== 'rejected' || classifyMetrics(403) !== 'rejected') {
	throw new Error('refusal');
}
if (classifyMetrics(401) !== 'signed-out') throw new Error('sign-in');
if (classifyMetrics(200) !== 'ready') throw new Error('ready');
if (classifyMetrics(500) !== 'failed') throw new Error('failed');

const view = readFileSync(new URL('../src/lib/catalog/portal/DashboardPanel.svelte', import.meta.url), 'utf8');
for (const sentence of [
	'Last 24 hours',
	'Last 7 days',
	'Last 30 days',
	'Last 90 days',
	'All nodes',
	'The server refused the live metrics stream.',
	'Failed to connect to live metrics.',
	'Live metrics stream disconnected after multiple retries.',
	'No data'
]) {
	if (!view.includes(sentence)) throw new Error('missing ' + sentence);
}
if (view.includes("from '$lib/adapter")) throw new Error('catalog fetches');

const dash = readFileSync(new URL('../src/routes/(portal)/portal/Dashboard.svelte', import.meta.url), 'utf8');
if (!dash.includes('requestLiveMetrics')) throw new Error('dashboard does not ask');

console.log('ok');
