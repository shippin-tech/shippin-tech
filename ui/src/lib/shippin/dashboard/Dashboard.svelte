<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchStats, isCustom, isPeriod, type Stats, type StatsRange, type StatsStatus } from '$lib/shippin/dashboard/stats';
	import { publishStatusSignal } from '$lib/adapter/signal';
	import { account } from '$lib/adapter/session';
	import PortalView from '$lib/shippin/admin/PortalView.svelte';

	const REFRESH_MS = 60_000;
	const PREFS = 'dashboard:prefs';

	let range = $state<StatsRange>({ period: '24h' });
	let node = $state<number | null>(null);
	let tab = $state('overview');
	let mode = $state<'bars' | 'lines'>('bars');
	let status = $state<'pending' | StatsStatus>('pending');
	let stats = $state<Stats | null>(null);
	let loading = $state(false);
	let message = $state('');
	let updated = $state<number | null>(null);
	let reload = $state(0);

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Record<string, unknown>;
			if (isPeriod(saved.period)) range = { period: saved.period };
			if (typeof saved.node === 'number') node = saved.node;
			if (typeof saved.tab === 'string') tab = saved.tab;
			if (saved.mode === 'bars' || saved.mode === 'lines') mode = saved.mode;
		} catch {
			// Preferences are a convenience; the defaults work without them.
		}
	});

	$effect(() => {
		const prefs = JSON.stringify({ period: isCustom(range) ? undefined : range.period, node, tab, mode });
		try {
			localStorage.setItem(PREFS, prefs);
		} catch {
			// Private windows can refuse storage.
		}
	});

	$effect(() => {
		const wanted = $state.snapshot(range) as StatsRange;
		const which = node;
		void reload;
		let cancelled = false;
		if (!account()) {
			status = 'signed-out';
			publishStatusSignal('metrics', 'metrics.session.signed-out', 'failed');
			return;
		}

		async function load(quiet: boolean) {
			if (quiet && typeof document !== 'undefined' && document.hidden) return;
			loading = true;
			const next = await fetchStats(wanted, which);
			if (cancelled) return;
			loading = false;
			status = next.status;
			message = next.message;
			if (next.stats) {
				stats = next.stats;
				updated = Date.now();
			}
			publishStatusSignal(
				'metrics',
				next.status === 'ready' ? 'metrics.stats.loaded' : `metrics.stats.${next.status}`,
				next.status === 'ready' ? 'open' : 'failed',
				isCustom(wanted) ? { from: wanted.from, to: wanted.to } : { period: wanted.period }
			);
		}

		void load(false);
		const timer = setInterval(() => load(true), REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	});
</script>

<PortalView
	view="CustomComponent/Dashboard"
	{range}
	{node}
	{status}
	{stats}
	{loading}
	{message}
	{tab}
	{mode}
	{updated}
	onrange={(next) => (range = next)}
	onnode={(next) => (node = next)}
	ontab={(next) => (tab = next)}
	onmode={(next) => (mode = next)}
	onrefresh={() => (reload += 1)}
/>
