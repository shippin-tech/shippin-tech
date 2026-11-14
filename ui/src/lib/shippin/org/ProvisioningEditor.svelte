<script lang="ts">
	import KeyNotice from '$lib/shippin/keys/KeyNotice.svelte';
	import { onMount } from 'svelte';
	import type { ProvisioningStatus, ProvisioningToken } from '$lib/shippin/org/provisioning';

	let {
		domain,
		onload,
		onmake,
		onrevoke
	}: {
		domain: string;
		onload: (domain: string) => Promise<ProvisioningStatus>;
		onmake: (domain: string) => Promise<ProvisioningToken>;
		onrevoke: (domain: string) => Promise<void>;
	} = $props();

	let status = $state<ProvisioningStatus | null>(null);
	let fresh = $state<ProvisioningToken | null>(null);
	let problem = $state('');
	let busy = $state(false);
	let confirming = $state(false);

	async function refresh() {
		try {
			status = await onload(domain);
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The provisioning settings could not be loaded.';
		}
	}

	onMount(refresh);

	async function run(action: () => Promise<void>) {
		busy = true;
		problem = '';
		try {
			await action();
			await refresh();
		} catch (err) {
			problem = err instanceof Error ? err.message : 'That could not be done.';
		}
		busy = false;
	}

	function make() {
		confirming = false;
		void run(async () => {
			fresh = await onmake(domain);
		});
	}

	function revoke() {
		confirming = false;
		void run(async () => {
			await onrevoke(domain);
			fresh = null;
		});
	}
</script>

<div class="provisioning">
	<p><strong>{domain}</strong>: {status?.hasToken ? 'an identity provider can manage its people over SCIM' : 'no SCIM token'}</p>
	{#if fresh}
		<div class="fresh" role="status">
			<p>Copy this now. It will not be shown again.</p>
			<p>Token: <code>{fresh.token}</code></p>
			<p>Endpoint: <code>{fresh.endpoint}</code></p>
		</div>
		<KeyNotice variant="scim" />
	{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	<div class="line">
		{#if status?.hasToken && !confirming}
			<button type="button" disabled={busy} onclick={() => (confirming = true)}>Replace or revoke the token<span class="sr"> for {domain}</span></button>
		{:else if status?.hasToken}
			<button type="button" disabled={busy} onclick={make}>Make a new token<span class="sr"> for {domain}</span></button>
			<button type="button" class="danger" disabled={busy} onclick={revoke}>Revoke the token<span class="sr"> for {domain}</span></button>
			<button type="button" onclick={() => (confirming = false)}>Keep it</button>
		{:else}
			<button type="button" disabled={busy} onclick={make}>Make a SCIM token<span class="sr"> for {domain}</span></button>
		{/if}
	</div>
</div>

<style>
	.provisioning { display: grid; gap: var(--y-2xs); min-width: 0; }
	p { margin: 0; overflow-wrap: anywhere; }
	.line { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	.fresh { display: grid; gap: 0.25rem; padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	code { overflow-wrap: anywhere; }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	.problem { font-weight: 600; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
