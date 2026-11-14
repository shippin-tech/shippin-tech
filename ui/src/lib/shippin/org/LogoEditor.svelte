<script lang="ts">
	import { logoFileProblem, logoUrl } from '$lib/shippin/org/brand-call';

	let {
		domain,
		onupload,
		onremove
	}: {
		domain: string;
		onupload: (domain: string, file: File) => Promise<void>;
		onremove: (domain: string) => Promise<void>;
	} = $props();

	let version = $state(Date.now());
	let missing = $state(false);
	let problem = $state('');
	let busy = $state(false);

	async function run(action: () => Promise<void>) {
		busy = true;
		problem = '';
		try {
			await action();
			missing = false;
			version = Date.now();
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The logo could not be changed.';
		}
		busy = false;
	}

	function picked(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		problem = logoFileProblem(file);
		if (!problem) void run(() => onupload(domain, file));
	}
</script>

<div class="logo">
	<div class="preview">
		{#if missing}
			<span class="muted">No logo for {domain}</span>
		{:else}
			<img src={logoUrl(domain, version)} alt="{domain} logo" onerror={() => (missing = true)} />
		{/if}
	</div>
	<label class="upload">
		<span>Choose a logo<span class="sr"> for {domain}</span></span>
		<input type="file" accept="image/png,image/jpeg,image/webp" onchange={picked} disabled={busy} />
	</label>
	{#if !missing}
		<button type="button" disabled={busy} onclick={() => run(() => onremove(domain))}>Remove logo<span class="sr"> for {domain}</span></button>
	{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</div>

<style>
	.logo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--x-2xs); }
	.preview { min-inline-size: 8rem; min-block-size: 2.75rem; display: flex; align-items: center; }
	img { block-size: 2.25rem; inline-size: auto; max-inline-size: 12rem; object-fit: contain; }
	.upload, button { font: inherit; display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	.upload:focus-within { outline: 2px solid var(--color-accent); outline-offset: 2px; }
	.upload input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
	.muted { color: var(--color-muted); overflow-wrap: anywhere; }
	.problem { margin: 0; flex-basis: 100%; font-weight: 600; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
