import { writable } from 'svelte/store';
import {
	createSignal,
	parseScriptedSignal,
	SCRIPTED_SIGNAL_EVENT,
	type PortalSignal
} from '../portal/signal';

export const MAX_PORTAL_SIGNALS = 4000;

const state = writable<PortalSignal[]>([]);
let webhook: string | null = null;

export const portalSignals = { subscribe: state.subscribe };

export function publishSignals(next: readonly PortalSignal[]): void {
	if (!next.length) return;
	state.update((current) => {
		const joined = current.concat(next);
		return joined.length > MAX_PORTAL_SIGNALS ? joined.slice(joined.length - MAX_PORTAL_SIGNALS) : joined;
	});
	void publishWebhook(next);
}

export function publishStatusSignal(channel: PortalSignal['channel'], eventType: string, status: PortalSignal['status'], payload: Record<string, unknown> = {}): void {
	publishSignals([createSignal({
		channel,
		eventType,
		resource: channel,
		status,
		severity: status === 'failed' ? 'error' : status === 'cancelled' ? 'warn' : 'info',
		payload
	})]);
}

export function configureSignalWebhook(url: string | null): { ok: boolean; message?: string } {
	if (!url || url.trim().length === 0) {
		webhook = null;
		return { ok: true };
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return { ok: false, message: 'Signal webhook must use http:// or https://.' };
		}
		webhook = parsed.toString();
		return { ok: true };
	} catch {
		return { ok: false, message: 'Signal webhook URL is invalid.' };
	}
}

export function bindScriptedSignals(target: EventTarget = window): () => void {
	const onScripted = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		const parsed = parseScriptedSignal(detail);
		if (!parsed.signal) {
			console.error('Ignoring scripted signal:', parsed.error ?? 'Malformed payload.');
			return;
		}
		publishSignals([parsed.signal]);
	};
	target.addEventListener(SCRIPTED_SIGNAL_EVENT, onScripted);
	return () => target.removeEventListener(SCRIPTED_SIGNAL_EVENT, onScripted);
}

async function publishWebhook(next: readonly PortalSignal[]): Promise<void> {
	if (!webhook || !next.length) return;
	try {
		const response = await fetch(webhook, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ signals: next })
		});
		if (!response.ok) {
			console.error(`Signal webhook failed with HTTP ${response.status}.`);
		}
	} catch (error) {
		console.error('Signal webhook failed:', error);
	}
}
