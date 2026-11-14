/**
 * MCPL v0 app events (mcpl/schema/event.schema.json).
 *
 * Call mcplEmit only after the action it names has succeeded on the server. Every
 * event type passed here must be listed in some component.json "emits"; the
 * conformance check (ui/scripts/check-mcpl.mjs) fails the build otherwise.
 * Payloads never carry secrets, passwords or message bodies.
 */
import { publishSignals } from '../adapter/signal';
import { createSignal, type PortalSignal } from '../portal/signal';

export function appEvent(eventType: string, resource: string, payload: Record<string, unknown> = {}): PortalSignal {
	return createSignal({ channel: 'app', eventType, resource, status: 'completed', severity: 'info', payload });
}

export function mcplEmit(eventType: string, resource: string, payload: Record<string, unknown> = {}): void {
	publishSignals([appEvent(eventType, resource, payload)]);
}
