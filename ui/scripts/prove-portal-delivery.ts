/**
 * Checks delivery event contracts; real execution is in prove-portal-records.mjs.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-delivery.ts
 */
import {
	FAILED_START,
	INVALID_TARGET,
	START_TRACE,
	deliveryStreamUrl,
	parseDeliveryFrame,
	phaseLabel,
	stageTone,
	validTarget
} from '../src/lib/portal/delivery.ts';

const frame = 'event: event\ndata: [{"type":"mxLookupStart","domain":"example.org"}]\n\n';
const stages = parseDeliveryFrame(frame);
if (stages[0]?.type !== 'mxLookupStart') throw new Error('stage');
if (phaseLabel('mxLookupStart') !== 'MX Lookup') throw new Error('mx');
if (phaseLabel('mtaStsNotFound') !== 'MTA-STS Policy Fetch') throw new Error('sts');
if (stageTone('mxLookupStart') !== 'pending') throw new Error('pending');
if (stageTone('mxLookupError') !== 'error') throw new Error('error');
if (stageTone('completed') !== 'ok') throw new Error('completed');
if (parseDeliveryFrame('event: event\ndata: [{"type":"completed"}]\n\n')[0]?.type !== 'completed') {
	throw new Error('done');
}

if (!validTarget('example.org') || !validTarget('john@example.org')) throw new Error('targets');
if (validTarget('not a domain') || validTarget('')) throw new Error('invalid target');
if (INVALID_TARGET !== 'Enter a valid email address or domain.') throw new Error('invalid copy');
if (deliveryStreamUrl('', 'example.org') !== '') throw new Error('empty token');
const url = deliveryStreamUrl('tok', 'John@Example.org');
if (url !== '/api/live/delivery/John%40Example.org?token=tok') throw new Error('url ' + url);
if (FAILED_START !== 'Failed to start trace.' || START_TRACE !== 'Start trace') throw new Error('start copy');

if (stages[0]?.domain !== 'example.org') throw new Error('stage details lost');

console.log('Delivery event contracts passed. Real stream: node scripts/prove-portal-records.mjs');
