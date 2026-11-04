<script lang="ts">
	import type { DomainVariant } from './variants';

	type Row = { id: string; name: string; detail: string };
	type Props = {
		variant: DomainVariant;
		rows: Row[];
		alert: string;
		pending: boolean;
		onload: () => void;
	};
	let { variant, rows, alert, pending, onload }: Props = $props();
</script>

<section class="card">
	<h1>Domains</h1>
	<p class="sub">Reads x:Domain/get. A tenant keeps domain control inside its ceiling.</p>
	<button type="button" disabled={pending} onclick={onload}>{pending ? 'Loading' : 'Load domains'}</button>
	{#if alert}<p class="alert" role="status">{alert}</p>{/if}
	{#if variant === 'list'}
		<ul>
			{#each rows as row (row.id)}
				<li><strong>{row.name || row.id}</strong> <span>{row.detail}</span></li>
			{/each}
		</ul>
	{:else if variant === 'empty'}
		<p>No domains returned.</p>
	{/if}
</section>

<style>
	.card { display: grid; gap: var(--space-2); width: min(40rem, 100%); margin: var(--space-4) auto; padding: var(--space-4); background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); }
	h1, p { margin: 0; }
	.sub, span { color: var(--color-muted); }
	.alert { color: var(--color-danger); }
	button { font: inherit; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius); background: var(--color-accent); color: var(--color-accent-fg); }
</style>
