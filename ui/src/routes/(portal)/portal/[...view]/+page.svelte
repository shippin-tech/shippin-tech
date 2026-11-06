<script lang="ts">
	import { page } from '$app/state';
	import { loadRegistry, rowCells } from '$lib/adapter/portal';
	import { account } from '$lib/adapter/session';
	import PortalView from '$lib/catalog/portal/PortalView.svelte';
	import ActionPanel from '$lib/catalog/portal/ActionPanel.svelte';
	import DeliveryRunner from '$lib/catalog/portal/DeliveryRunner.svelte';
	import { deliveryNodes } from '$lib/flow/delivery/nodes';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { findView } from '$lib/portal/view';
	import Dashboard from '../Dashboard.svelte';
	import LiveTracing from '../LiveTracing.svelte';

	const view = $derived(page.params.view ?? '');

	let rows = $state<Record<string, string>[]>([]);
	let phase = $state<'pending' | 'signed-out' | 'ready' | 'error'>('pending');
	let notice = $state('');

	function namesFor(id: string): string[] {
		const record = findView(id);
		if (!record) return [];
		const names = new Set<string>();
		for (const column of record.columns) names.add(column.name);
		for (const section of record.sections) {
			for (const field of section.fields) names.add(field.name);
		}
		return [...names];
	}

	function outcome(err: unknown): { phase: 'signed-out' | 'error'; notice: string } {
		const message = err instanceof Error ? err.message : 'Failed to load this view.';
		if (message === 'sign-in required') return { phase: 'signed-out', notice: '' };
		if (message.includes('Enterprise')) {
			return { phase: 'error', notice: 'This feature requires an Enterprise license.' };
		}
		if (message.toLowerCase().includes('bootstrap mode')) {
			return { phase: 'error', notice: `Welcome to ShippinTECH. ${message}` };
		}
		return { phase: 'error', notice: message };
	}

	$effect(() => {
		const id = view;
		const record = findView(id);
		let cancelled = false;
		rows = [];
		notice = '';
		if (id === 'x:Action' || !record || record.kind === 'custom') {
			phase = 'ready';
			return;
		}
		if (!account()) {
			phase = 'signed-out';
			return;
		}
		phase = 'pending';
		const names = namesFor(id);
		loadRegistry(record.object)
			.then((list) => {
				if (cancelled) return;
				rows = list.map((row) => rowCells(row, names));
				phase = 'ready';
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				const next = outcome(err);
				phase = next.phase;
				notice = next.notice;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

{#if view === 'CustomComponent/Dashboard'}
	<Dashboard />
{:else if view === 'CustomComponent/LiveTracing'}
	<LiveTracing />
{:else if view === 'CustomComponent/LiveDelivery'}
	{#key view}
		<PortalView {view} {rows} {phase} {notice} />
		<DeliveryRunner />
		<GraphMount items={deliveryNodes} />
	{/key}
{:else if view === 'x:Action'}
	<ActionPanel />
{:else}
	{#key view}
		<PortalView {view} {rows} {phase} {notice} />
	{/key}
{/if}
