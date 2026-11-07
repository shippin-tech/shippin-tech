<script lang="ts">
	import { findView } from '$lib/portal/view';
	import DashboardPanel from './DashboardPanel.svelte';
	import RecordForm from './RecordForm.svelte';
	import RecordTable from './RecordTable.svelte';
	import { createLabel, objectLabel } from '$lib/portal/writes';

	let {
		view = 'CustomComponent/Dashboard',
		rows = [],
		phase = 'pending',
		notice = '',
		period = '24h',
		metrics = 'pending',
		counts = {},
		points = [],
		onperiod
	}: {
		view?: string;
		rows?: Record<string, string>[];
		phase?: 'pending' | 'signed-out' | 'ready' | 'error';
		notice?: string;
		period?: '24h' | '7d' | '30d' | '90d';
		metrics?: 'pending' | 'signed-out' | 'rejected' | 'failed' | 'ready' | 'disconnected';
		counts?: Record<string, number>;
		points?: readonly { step: number; count: number }[];
		onperiod?: (next: '24h' | '7d' | '30d' | '90d') => void;
	} = $props();

	let selected = $state<number | null>(null);
	let creating = $state(false);

	$effect(() => {
		void view;
		selected = null;
		creating = false;
	});

	const record = $derived(findView(view));
	const picked = $derived(
		record?.kind === 'singleton' || !record?.columns.length
			? rows[0]
			: selected == null
				? undefined
				: rows[selected]
	);
	const dashboardView = $derived(view === '' || view === 'CustomComponent/Dashboard');
	const subject = $derived(record ? objectLabel(record.object) : '');
	const title = $derived(
		creating && subject
			? createLabel(subject)
			: view === 'CustomComponent/LiveTracing'
				? 'Live Tracing'
				: view === 'CustomComponent/LiveDelivery'
					? 'Delivery tests'
					: record?.listTitle || 'Dashboard'
	);
	const rowLabel = $derived(
		record && picked && record.columns[0]
			? picked[record.columns[0].name] || record.listTitle || record.view
			: record?.listTitle || record?.view || ''
	);
</script>

<svelte:head>
	<title>{title} · shippin</title>
</svelte:head>

<article>
	{#if dashboardView}
		<DashboardPanel {period} {metrics} {counts} {points} {onperiod} />
	{:else if view === 'CustomComponent/LiveTracing' || notice === 'This feature requires an Enterprise license.'}
		<h1>{title}</h1>
		<p role="status">This feature requires an Enterprise license.</p>
	{:else if !record}
		<h1>Unknown view: {view}</h1>
	{:else}
		<h1>{title}</h1>
		{#if record.listSubtitle}<p class="sub">{record.listSubtitle}</p>{/if}
		{#if record.description}<p class="sub">{record.description}</p>{/if}
		{#if notice && phase === 'error'}
			<p class="sub" role="status">{notice}</p>
		{/if}
		{#if record.columns.length}
			<RecordTable columns={record.columns} {rows} {phase} {selected} onselect={(index) => (selected = index)} />
		{:else if phase === 'signed-out'}
			<p><a href="/login">Sign in</a></p>
		{/if}
		{#if phase === 'ready'}<RecordForm sections={record.sections} {picked} />{/if}
	{/if}
</article>

<style>
	article { display: grid; gap: var(--y-s); }
	h1, p { margin: 0; }
	.sub { color: var(--color-muted); }
</style>
