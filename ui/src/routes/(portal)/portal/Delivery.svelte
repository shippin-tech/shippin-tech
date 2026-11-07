<script lang="ts">
	import { onDestroy } from 'svelte';
	import { startDelivery, type DeliveryPhase } from '$lib/adapter/delivery';
	import type { DeliveryStage } from '$lib/portal/delivery';
	import DeliveryRunner from '$lib/catalog/portal/DeliveryRunner.svelte';
	let stages = $state<DeliveryStage[]>([]);
	let phase = $state<DeliveryPhase>('idle');
	let notice = $state('');
	let stop: (() => void) | undefined;
	function start(target: string) {
		stop?.();
		stages = [];
		stop = startDelivery(target, (next) => { stages = [...stages, ...next]; }, (next, message) => { phase = next; notice = message; });
	}
	function cancel() { stop?.(); phase = 'cancelled'; notice = 'Trace cancelled.'; }
	onDestroy(() => stop?.());
</script>

<DeliveryRunner {stages} {phase} {notice} onstart={start} onstop={cancel} />
