import type { MetricSample } from '$lib/adapter/metrics-call';
import type { DeliveryStage } from '$lib/portal/delivery';
import type { TraceEvent } from '$lib/portal/trace';

export type SignalChannel = 'metrics' | 'tracing' | 'delivery' | 'scripted';
export type SignalSource = 'portal' | 'scripted-ai';
export type SignalStatus = 'pending' | 'open' | 'completed' | 'cancelled' | 'failed' | 'info';
export type SignalSeverity = 'info' | 'warn' | 'error';

export type PortalSignal = {
	id: string;
	timestamp: string;
	channel: SignalChannel;
	source: SignalSource;
	eventType: string;
	resource: string;
	status: SignalStatus;
	severity: SignalSeverity;
	traceId?: string;
	tenantId?: string;
	actor?: string;
	payload: Record<string, unknown>;
};

export const SCRIPTED_SIGNAL_EVENT = 'shippin:signal-script';

type SignalBase = Omit<PortalSignal, 'id' | 'timestamp' | 'source' | 'payload'> & {
	source?: SignalSource;
	payload?: Record<string, unknown>;
};

let signalCounter = 0;

export function createSignal(base: SignalBase): PortalSignal {
	signalCounter = (signalCounter + 1) % Number.MAX_SAFE_INTEGER;
	return {
		id: `${Date.now()}-${signalCounter}`,
		timestamp: new Date().toISOString(),
		source: base.source ?? 'portal',
		payload: base.payload ?? {},
		...base
	};
}

export function metricSignals(samples: readonly MetricSample[]): PortalSignal[] {
	return samples.map((sample) =>
		createSignal({
			channel: 'metrics',
			eventType: `metrics.${sample.metric}`,
			resource: sample.metric,
			status: 'open',
			severity: 'info',
			payload: {
				metric: sample.metric,
				type: sample.type,
				count: sample.count,
				sum: sample.sum
			}
		})
	);
}

export function traceSignals(events: readonly TraceEvent[]): PortalSignal[] {
	return events.map((event) =>
		createSignal({
			channel: 'tracing',
			eventType: `trace.${event.event}`,
			resource: 'live-tracing',
			status: 'open',
			severity: traceSeverity(event.event),
			traceId: event.timestamp,
			payload: {
				event: event.event,
				timestamp: event.timestamp,
				keyValues: event.keyValues
			}
		})
	);
}

export function deliverySignals(stages: readonly DeliveryStage[]): PortalSignal[] {
	return stages.map((stage) => {
		const type = String(stage.type ?? 'unknown');
		return createSignal({
			channel: 'delivery',
			eventType: `delivery.${type}`,
			resource: 'delivery-trace',
			status: deliveryStatus(type),
			severity: deliverySeverity(type),
			payload: { ...stage }
		});
	});
}

export function parseScriptedSignal(value: unknown): { signal?: PortalSignal; error?: string } {
	if (!value || typeof value !== 'object') return { error: 'Scripted signal payload must be an object.' };
	const raw = value as Record<string, unknown>;
	const eventType = stringField(raw, 'eventType');
	if (!eventType) return { error: 'Scripted signal payload must include eventType.' };
	const resource = stringField(raw, 'resource') ?? 'chat-overlay';
	const channel = signalChannel(raw.channel);
	const status = signalStatus(raw.status);
	const severity = signalSeverity(raw.severity);
	const payload = objectField(raw, 'payload') ?? {};
	return {
		signal: createSignal({
			channel,
			eventType,
			resource,
			status,
			severity,
			traceId: stringField(raw, 'traceId'),
			tenantId: stringField(raw, 'tenantId'),
			actor: stringField(raw, 'actor'),
			source: 'scripted-ai',
			payload
		})
	};
}

export function signalBlueprint(signal: PortalSignal): string | undefined {
	const blueprint = signal.payload.blueprint;
	return typeof blueprint === 'string' && blueprint.trim().length > 0 ? blueprint : undefined;
}

export function isBlueprintSignal(signal: PortalSignal, blueprint: string): boolean {
	if (signal.eventType === `deploy.blueprint.${blueprint}`) return true;
	return signal.eventType === 'deploy.request.submitted' && signalBlueprint(signal) === blueprint;
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
	const value = record[name];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function objectField(record: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
	const value = record[name];
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function signalChannel(value: unknown): SignalChannel {
	return value === 'metrics' || value === 'tracing' || value === 'delivery' || value === 'scripted'
		? value
		: 'scripted';
}

function signalStatus(value: unknown): SignalStatus {
	return value === 'pending' || value === 'open' || value === 'completed' || value === 'cancelled' || value === 'failed'
		? value
		: 'info';
}

function signalSeverity(value: unknown): SignalSeverity {
	return value === 'warn' || value === 'error' ? value : 'info';
}

function traceSeverity(name: string): SignalSeverity {
	const lower = name.toLowerCase();
	if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid') || lower.includes('reject')) return 'error';
	if (lower.includes('warn') || lower.includes('notfound')) return 'warn';
	return 'info';
}

function deliveryStatus(type: string): SignalStatus {
	if (type === 'completed') return 'completed';
	if (type.endsWith('Error')) return 'failed';
	return 'open';
}

function deliverySeverity(type: string): SignalSeverity {
	if (type.endsWith('Error')) return 'error';
	if (type.endsWith('NotFound')) return 'warn';
	return 'info';
}
