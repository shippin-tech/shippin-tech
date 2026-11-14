<script lang="ts">
	import { onMount } from 'svelte';
	import { account } from '$lib/adapter/session';
	import { applyBaseline, loadBaselineRecords } from '$lib/adapter/baseline';
	import { BASELINES, type Baseline, type BaselineRecords } from '$lib/portal/baseline';
	import SecurityBaseline from '$lib/shippin/admin/SecurityBaseline.svelte';

	let records = $state<BaselineRecords>({});
	let phase = $state<'pending' | 'signed-out' | 'ready' | 'error'>('pending');
	let notice = $state('');
	let busy = $state('');

	async function refresh() {
		records = await loadBaselineRecords(BASELINES);
		phase = 'ready';
	}

	function fail(err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to load the security baseline.';
		if (message === 'sign-in required') { phase = 'signed-out'; return; }
		phase = 'ready';
		notice = message.includes('Enterprise') ? 'This feature requires an Enterprise license.' : message;
	}

	onMount(() => {
		if (!account()) { phase = 'signed-out'; return; }
		refresh().catch(fail);
	});

	async function onapply(baseline: Baseline, on: boolean) {
		busy = baseline.id;
		notice = '';
		try {
			const written = await applyBaseline(baseline, on);
			await refresh();
			notice = `${baseline.title}: ${on ? 'on' : 'off'}. Updated ${written.join(', ')}.`;
		} catch (err) {
			fail(err);
			try { await refresh(); } catch { /* keep the notice from the write */ }
		} finally {
			busy = '';
		}
	}
</script>

<svelte:head><title>Security baseline</title></svelte:head>

{#if phase === 'signed-out'}
	<p>Sign in to manage the security baseline. <a href="/login">Sign in</a></p>
{:else if phase === 'pending'}
	<p aria-busy="true">Loading server settings…</p>
{:else}
	<SecurityBaseline baselines={BASELINES} {records} {busy} {notice} {onapply} />
{/if}
