import { describe, expect, it } from 'vitest';
import type { DeliveryStage } from '../src/lib/portal/delivery';
import type { MetricSample } from '../src/lib/adapter/metrics-call';
import type { TraceEvent } from '../src/lib/portal/trace';
import {
	deliverySignals,
	isBlueprintSignal,
	metricSignals,
	parseScriptedSignal,
	signalBlueprint,
	traceSignals
} from '../src/lib/portal/signal';

describe('portal signal contract', () => {
	it('normalizes metrics, tracing and delivery updates into canonical signals', () => {
		const metrics: MetricSample[] = [{ metric: 'user.count', type: 'Gauge', count: 7 }];
		const traces: TraceEvent[] = [{ event: 'delivery-start', timestamp: '2026-11-08T00:00:00Z', keyValues: [] }];
		const stages: DeliveryStage[] = [{ type: 'mxLookup' }, { type: 'connectionError' }];
		const metric = metricSignals(metrics)[0];
		const trace = traceSignals(traces)[0];
		const delivery = deliverySignals(stages);
		expect(metric).toMatchObject({
			channel: 'metrics',
			eventType: 'metrics.user.count',
			resource: 'user.count',
			status: 'open',
			severity: 'info'
		});
		expect(trace).toMatchObject({
			channel: 'tracing',
			eventType: 'trace.delivery-start',
			resource: 'live-tracing',
			status: 'open'
		});
		expect(delivery[0]).toMatchObject({
			channel: 'delivery',
			eventType: 'delivery.mxLookup',
			status: 'open'
		});
		expect(delivery[1]).toMatchObject({
			channel: 'delivery',
			eventType: 'delivery.connectionError',
			status: 'failed',
			severity: 'error'
		});
	});

	it('validates scripted signal payloads', () => {
		const parsed = parseScriptedSignal({
			eventType: 'ai.plan.accepted',
			resource: 'chat-overlay',
			status: 'completed',
			severity: 'info',
			traceId: 'trace-1',
			payload: { stage: 'authoring' }
		});
		expect(parsed.error).toBeUndefined();
		expect(parsed.signal).toMatchObject({
			channel: 'scripted',
			source: 'scripted-ai',
			eventType: 'ai.plan.accepted',
			resource: 'chat-overlay',
			status: 'completed'
		});
		const invalid = parseScriptedSignal({ resource: 'chat-overlay' });
		expect(invalid.signal).toBeUndefined();
		expect(invalid.error).toContain('eventType');
	});

	it('classifies blueprint trigger and request signals', () => {
		const trigger = parseScriptedSignal({
			eventType: 'deploy.blueprint.mail',
			resource: 'workspace-mail',
			payload: { blueprint: 'mail' }
		}).signal;
		expect(trigger).toBeDefined();
		expect(signalBlueprint(trigger!)).toBe('mail');
		expect(isBlueprintSignal(trigger!, 'mail')).toBe(true);
		const request = parseScriptedSignal({
			eventType: 'deploy.request.submitted',
			resource: 'platform-control',
			payload: { blueprint: 'drive' }
		}).signal;
		expect(request).toBeDefined();
		expect(isBlueprintSignal(request!, 'drive')).toBe(true);
		expect(isBlueprintSignal(request!, 'mail')).toBe(false);
	});
});
