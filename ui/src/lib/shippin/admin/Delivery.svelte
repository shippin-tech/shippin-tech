<script lang="ts">
	import { onDestroy } from 'svelte';
	import { startDelivery, type DeliveryPhase } from '$lib/adapter/delivery';
	import { publishSignals, publishStatusSignal } from '$lib/adapter/signal';
	import type { DeliveryStage } from '$lib/portal/delivery';
	import DeliveryRunner from '$lib/shippin/admin/DeliveryRunner.svelte';
	import { deliverySignals } from '$lib/portal/signal';
	let stages = $state<DeliveryStage[]>([]);
	let phase = $state<DeliveryPhase>('idle');
	let notice = $state('');
	let stop: (() => void) | undefined;
	function start(target: string) {
		stop?.();
		stages = [];
		publishStatusSignal('delivery', 'delivery.trace.connecting', 'pending', { target });
		stop = startDelivery(
			target,
			(next) => {
				stages = [...stages, ...next];
				publishSignals(deliverySignals(next));
			},
			(next, message) => {
				phase = next;
				notice = message;
				publishStatusSignal(
					'delivery',
					next === 'running'
						? 'delivery.trace.open'
						: next === 'completed'
							? 'delivery.trace.completed'
							: next === 'cancelled'
								? 'delivery.trace.cancelled'
								: next === 'failed'
									? 'delivery.trace.failed'
									: 'delivery.trace.idle',
					next === 'completed' ? 'completed' : next === 'cancelled' ? 'cancelled' : next === 'failed' ? 'failed' : 'open',
					{ target, message }
				);
			}
		);
	}
	function cancel() {
		stop?.();
		phase = 'cancelled';
		notice = 'Trace cancelled.';
		publishStatusSignal('delivery', 'delivery.trace.cancelled', 'cancelled');
	}
	onDestroy(() => stop?.());
</script>

<DeliveryRunner {stages} {phase} {notice} onstart={start} onstop={cancel} />
