<script lang="ts">
	import KeyNotice from '$lib/shippin/keys/KeyNotice.svelte';
	import { onMount } from 'svelte';
	import type { SsoDraft, SsoSettings } from '$lib/shippin/org/sso';

	let {
		domain,
		onload,
		onsave,
		onclear
	}: {
		domain: string;
		onload: (domain: string) => Promise<SsoSettings>;
		onsave: (domain: string, draft: SsoDraft) => Promise<void>;
		onclear: (domain: string) => Promise<void>;
	} = $props();

	let saved = $state<SsoSettings | null>(null);
	let draft = $state<SsoDraft>({ issuer: '', clientId: '', clientSecret: '', enabled: false });
	let open = $state(false);
	let problem = $state('');
	let done = $state('');
	let busy = $state(false);

	async function refresh() {
		try {
			saved = await onload(domain);
			draft = { issuer: saved.issuer ?? '', clientId: saved.clientId ?? '', clientSecret: '', enabled: saved.enabled };
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The sign-in settings could not be loaded.';
		}
	}

	onMount(refresh);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		problem = '';
		done = '';
		if (!draft.issuer.trim() || !draft.clientId.trim()) {
			problem = 'Enter the provider address and client ID.';
			return;
		}
		if (!draft.clientSecret && !saved?.hasSecret) {
			problem = 'Enter the client secret.';
			return;
		}
		busy = true;
		try {
			await onsave(domain, draft);
			done = 'Saved.';
			open = false;
			await refresh();
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The sign-in settings could not be saved.';
		}
		busy = false;
	}

	async function clear() {
		problem = '';
		done = '';
		busy = true;
		try {
			await onclear(domain);
			done = 'Removed.';
			open = false;
			await refresh();
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The sign-in settings could not be removed.';
		}
		busy = false;
	}
</script>

<div class="sso">
	<div class="line">
		<p><strong>{domain}</strong>: {saved?.enabled ? `signs in through ${saved.issuer}` : 'signs in with passwords'}</p>
		<button type="button" onclick={() => (open = !open)} aria-expanded={open}>{open ? 'Close' : 'Set up'}<span class="sr"> sign-in for {domain}</span></button>
	</div>
	{#if done}<p role="status">{done}</p>{/if}
	{#if problem && !open}<p class="problem" role="alert">{problem}</p>{/if}
	{#if open}
		<form onsubmit={submit} aria-label="Sign-in for {domain}" novalidate>
			{#if saved}<p class="muted">Register this address with your provider: <code>{saved.callback}</code></p>{/if}
			<label><span>Provider address (issuer)</span><input bind:value={draft.issuer} type="url" autocomplete="off" spellcheck="false" /></label>
			<label><span>Client ID</span><input bind:value={draft.clientId} autocomplete="off" spellcheck="false" /></label>
			<label>
				<span>Client secret{saved?.hasSecret ? ' (leave empty to keep it)' : ''}</span>
				<input bind:value={draft.clientSecret} type="password" autocomplete="new-password" />
			</label>
			<KeyNotice variant="sso" detailsOpen={!saved?.hasSecret} />
			<label class="check"><input type="checkbox" bind:checked={draft.enabled} /> Offer this sign-in</label>
			<p class="muted">People need an account here already. The server's administrators always use a password.</p>
			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
			<div class="line">
				<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving' : 'Save sign-in'}</button>
				{#if saved?.hasSecret}<button type="button" disabled={busy} onclick={clear}>Remove sign-in</button>{/if}
			</div>
		</form>
	{/if}
</div>

<style>
	.sso { display: grid; gap: var(--y-2xs); min-width: 0; }
	p { margin: 0; overflow-wrap: anywhere; }
	.line { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--x-2xs); }
	form { display: grid; gap: 0.75rem; max-width: 36rem; padding: var(--y-s) var(--x-s); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	form label:not(.check) { display: grid; gap: 0.25rem; }
	form label > span { font-size: 0.875rem; color: var(--color-muted); }
	input:not([type='checkbox']), button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	input:not([type='checkbox']) { width: 100%; }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	.check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; }
	.check input { width: 1.25rem; height: 1.25rem; }
	.muted { color: var(--color-muted); }
	.problem { font-weight: 600; }
	code { overflow-wrap: anywhere; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
