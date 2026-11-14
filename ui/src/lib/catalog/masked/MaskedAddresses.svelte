<script lang="ts">
	import { maskedCount, maskedName, maskedStatus, type MaskedAddress } from '$lib/adapter/masked-call';

	let {
		addresses,
		limit,
		notice,
		problem,
		oncreate,
		ontoggle,
		onremove
	}: {
		addresses: MaskedAddress[];
		limit: number;
		notice: string;
		problem: string;
		oncreate: (label: string) => Promise<boolean>;
		ontoggle: (item: MaskedAddress, enabled: boolean) => void;
		onremove: (item: MaskedAddress) => void;
	} = $props();

	let label = $state('');
	let creating = $state(false);
	let confirming = $state('');
	let copied = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		creating = true;
		const made = await oncreate(label);
		creating = false;
		if (made) label = '';
	}

	async function copy(item: MaskedAddress) {
		try {
			await navigator.clipboard.writeText(item.address);
			copied = item.address;
		} catch {
			copied = '';
		}
	}
</script>

<section class="masked" aria-labelledby="masked-title">
	<header>
		<a href="/mail">Back to mail</a>
		<h1 id="masked-title">Masked addresses</h1>
		<p class="muted">Give a shop or a sign-up form one of these instead of your real address. Mail to it lands in your Inbox, and switching it off refuses that mail.</p>
	</header>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	<form onsubmit={submit} aria-label="New masked address">
		<label>
			<span>What is it for?</span>
			<input bind:value={label} maxlength="120" autocomplete="off" />
		</label>
		<button type="submit" class="primary" disabled={creating}>{creating ? 'Making it' : 'Make an address'}</button>
	</form>

	{#if !notice}
		<p class="muted">{maskedCount(addresses.length, limit)}</p>
	{/if}

	{#if addresses.length === 0 && !notice}
		<p class="muted">No masked addresses yet.</p>
	{:else}
		<ul aria-label="Your masked addresses">
			{#each addresses as item (item.address)}
				<li>
					<div class="what">
						<h2>{item.address}</h2>
						<p>{maskedName(item)}</p>
						<p class="muted">{maskedStatus(item.enabled)}</p>
					</div>
					<div class="actions">
						<button type="button" onclick={() => copy(item)}>{copied === item.address ? 'Copied' : 'Copy'}<span class="sr"> {item.address}</span></button>
						<label class="check">
							<input type="checkbox" checked={item.enabled} onchange={(event) => ontoggle(item, event.currentTarget.checked)} />
							Turned on<span class="sr">: {item.address}</span>
						</label>
						{#if confirming === item.address}
							<button type="button" class="danger" onclick={() => onremove(item)}>Confirm remove<span class="sr"> {item.address}</span></button>
							<button type="button" onclick={() => (confirming = '')}>Keep</button>
						{:else}
							<button type="button" onclick={() => (confirming = item.address)}>Remove<span class="sr"> {item.address}</span></button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.masked { display: grid; gap: var(--y-s); min-width: 0; max-width: 56rem; margin-inline: auto; padding: var(--y-s) var(--x-s); }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; display: grid; gap: var(--y-2xs); }
	form, .actions { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	form label:not(.check) { display: grid; gap: 0.25rem; flex: 1 1 16rem; }
	form label span { font-size: 0.875rem; color: var(--color-muted); }
	input:not([type='checkbox']), button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	input:not([type='checkbox']) { width: 100%; }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
	li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--x-s); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.what { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 18rem; }
	.check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; }
	.check input { width: 1.25rem; height: 1.25rem; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
