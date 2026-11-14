<script lang="ts">
	import { brand } from '$lib/brand/brand.generated';
	import { findView } from '$lib/portal/view';
	import DashboardPanel from '../dashboard/DashboardPanel.svelte';
	import type { Stats, StatsRange, StatsStatus } from '$lib/shippin/dashboard/stats-call';
	import RecordForm from './RecordForm.svelte';
	import RecordTable from './RecordTable.svelte';
	import { createLabel, objectLabel } from '$lib/portal/writes';

	let {
		view = 'CustomComponent/Dashboard',
		rows = [],
		phase = 'pending',
		notice = '',
		range = { period: '24h' },
		node = null,
		status = 'pending',
		stats = null,
		loading = false,
		message = '',
		tab = 'overview',
		mode = 'bars',
		updated = null,
		onrange,
		onnode,
		ontab,
		onmode,
		onrefresh
	}: {
		view?: string;
		rows?: Record<string, string>[];
		phase?: 'pending' | 'signed-out' | 'ready' | 'error';
		notice?: string;
		range?: StatsRange;
		node?: number | null;
		status?: 'pending' | StatsStatus;
		stats?: Stats | null;
		loading?: boolean;
		message?: string;
		tab?: string;
		mode?: 'bars' | 'lines';
		updated?: number | null;
		onrange?: (next: StatsRange) => void;
		onnode?: (next: number | null) => void;
		ontab?: (next: string) => void;
		onmode?: (next: 'bars' | 'lines') => void;
		onrefresh?: () => void;
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
	<title>{title} · {brand.name}</title>
</svelte:head>

<article>
	{#if dashboardView}
		<DashboardPanel {range} {node} {status} {stats} {loading} {message} {tab} {mode} {updated} {onrange} {onnode} {ontab} {onmode} {onrefresh} />
	{:else if notice === 'This feature requires an Enterprise license.'}
		<h1>{title}</h1>
		<p role="status">Not available yet. This is one of the features being rebuilt as our own code; see RELEASE.md, section F.</p>
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
