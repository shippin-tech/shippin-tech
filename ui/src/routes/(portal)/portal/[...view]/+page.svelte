<script lang="ts">
	import { page } from '$app/state';
	import { loadRegistry, loadPortalSchema, writeRegistry, rowCells } from '$lib/adapter/portal';
	import type { RegistryChange } from '$lib/adapter/writes-call';
	import type { PortalSchema, ReferenceOption } from '$lib/portal/schema';
	import RegistryEditor from '$lib/catalog/portal/RegistryEditor.svelte';
	import { account } from '$lib/adapter/session';
	import PortalView from '$lib/catalog/portal/PortalView.svelte';
	import ActionPanel from '$lib/catalog/portal/ActionPanel.svelte';
	import { executeAction } from '$lib/adapter/actions';
	import Delivery from '../Delivery.svelte';
	import { findView } from '$lib/portal/view';
	import Dashboard from '../Dashboard.svelte';
	import LiveTracing from '../LiveTracing.svelte';

	const view = $derived(page.params.view ?? '');
	const record = $derived(findView(view));
	let schema = $state<PortalSchema | null>(null);
	let records = $state<Record<string, unknown>[]>([]);

	let rows = $state<Record<string, string>[]>([]);
	let phase = $state<'pending' | 'signed-out' | 'ready' | 'error'>('pending');
	let notice = $state('');
	const referenceCache = new Map<string, Promise<ReferenceOption[]>>();
	async function references(name: string): Promise<ReferenceOption[]> {
		if (!schema) throw new Error('The server schema is not loaded.');
		const currentSchema = schema;
		const key = `${account()?.accountId}:${name}`;
		let promise = referenceCache.get(key);
		if (!promise) {
			const spec = currentSchema.objects[name];
			promise = loadRegistry(spec?.objectName ?? name, currentSchema.lists[name]?.filtersStatic).then((items) => items.map((item) => ({
				id: String(item.id), label: String(item[currentSchema.lists[name]?.labelProperty ?? ''] ?? item.name ?? item.emailAddress ?? item.key ?? item.id)
			})));
			referenceCache.set(key, promise);
			promise.catch(() => referenceCache.delete(key));
		}
		return promise;
	}

	function namesFor(id: string): string[] {
		const record = findView(id);
		if (!record) return [];
		const names = new Set<string>(['id']);
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
		referenceCache.clear();
		notice = '';
		if (!record || record.kind === 'custom') {
			phase = 'ready';
			return;
		}
		if (!account()) {
			phase = 'signed-out';
			return;
		}
		phase = 'pending';
		const names = namesFor(id);
		loadPortalSchema().then(async (serverSchema) => {
				const list = id === 'x:Action' ? [] : await loadRegistry(record.object, serverSchema.lists[id]?.filtersStatic, serverSchema.objects[record.object]?.type === 'singleton' ? ['singleton'] : undefined);
				if (cancelled) return;
				schema = serverSchema;
				records = list;
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

	async function save(change: RegistryChange, id: string): Promise<string> {
		if (!record) throw new Error('Unknown portal view.');
		const target = record;
		const targetView = view;
		const currentSchema = schema;
		const savedId = await writeRegistry(target.object, change, id);
		referenceCache.clear();
		try {
			const list = await loadRegistry(target.object, currentSchema?.lists[targetView]?.filtersStatic, currentSchema?.objects[target.object]?.type === 'singleton' ? ['singleton'] : undefined);
			if (view === targetView) {
				records = list;
				rows = list.map((row) => rowCells(row, namesFor(targetView)));
			}
		} catch (error) {
			// The mutation was confirmed: remove the editor so retry cannot create a duplicate.
			if (view === targetView) {
				phase = 'error';
				notice = `The server saved the change, but refreshing failed. Reload this page before making another change. ${error instanceof Error ? error.message : ''}`;
			}
		}
		return savedId;
	}
</script>

{#if view === 'CustomComponent/Dashboard'}
	<Dashboard />
{:else if view === 'CustomComponent/LiveTracing'}
	<LiveTracing />
{:else if view === 'CustomComponent/LiveDelivery'}
	{#key view}
		<Delivery />
	{/key}
{:else if view === 'x:Action'}
	{#if phase === 'ready' && schema}<ActionPanel {schema} {references} execute={executeAction} />{:else}<PortalView {view} {rows} {phase} {notice} />{/if}
{:else}
	{#key view}
		{#if phase === 'ready' && record && schema}
			<RegistryEditor {record} {schema} {records} {rows} {save} {references} />
		{:else}
			<PortalView {view} {rows} {phase} {notice} />
		{/if}
	{/key}
{/if}
