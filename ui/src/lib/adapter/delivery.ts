import { authorization } from './session';
import { deliveryStreamUrl, parseDeliveryFrame, validTarget, type DeliveryStage } from '$lib/portal/delivery';

export type DeliveryPhase = 'idle' | 'connecting' | 'running' | 'completed' | 'cancelled' | 'failed';

export function startDelivery(target: string, onstage: (stages: DeliveryStage[]) => void, onstatus: (phase: DeliveryPhase, notice: string) => void): () => void {
	const controller = new AbortController();
	let source: EventSource | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	function stop() {
		stopped = true;
		controller.abort();
		source?.close();
		if (timer) clearTimeout(timer);
	}
	function fail(message: string) { stop(); onstatus('failed', message); }
	onstatus('connecting', 'Starting delivery trace...');
	void (async () => {
		try {
			if (!validTarget(target)) throw new Error('Enter a valid email address or domain.');
			const auth = authorization();
			if (!auth) throw new Error('Sign in to start a delivery trace.');
			timer = setTimeout(() => fail('Trace timed out after 120 seconds.'), 120000);
			const response = await fetch('/api/token/delivery', { headers: { Authorization: auth }, cache: 'no-store', signal: controller.signal });
			if (!response.ok) throw new Error(`The server refused the delivery trace: HTTP ${response.status}.`);
			const token = (await response.text()).trim();
			if (stopped) return;
			const url = deliveryStreamUrl(token, target);
			if (!url) throw new Error('The server did not issue a delivery token.');
			source = new EventSource(url);
			source.onopen = () => onstatus('running', 'Tracing delivery...');
			source.onerror = () => fail('Connection lost before the delivery trace completed.');
			source.addEventListener('event', (event) => {
				if (stopped) return;
				try {
					const stages = parseDeliveryFrame(`data: ${(event as MessageEvent).data}`);
					const end = stages.findIndex((stage) => stage.type === 'completed');
					onstage(end < 0 ? stages : stages.slice(0, end));
					if (end >= 0) { stop(); onstatus('completed', 'Trace completed. Review the delivery stages for the outcome.'); }
				} catch { fail('The server returned an invalid delivery event.'); }
			});
		} catch (cause) {
			if (!stopped) fail(cause instanceof Error ? cause.message : 'Could not start the delivery trace.');
		}
	})();
	return stop;
}
