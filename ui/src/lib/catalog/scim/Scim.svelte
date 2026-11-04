<script lang="ts">
	import type { ScimVariant } from './variants';

	type Props = {
		variant: ScimVariant;
		body: string;
		alert: string;
		pending: boolean;
		onload: () => void;
	};
	let { variant, body, alert, pending, onload }: Props = $props();
</script>

<section class="card">
	<h1>SCIM</h1>
	<p class="sub">Reads GET /scim/ServiceProviderConfig.</p>
	<button type="button" disabled={pending} onclick={onload}>{pending ? 'Loading' : 'Load provider'}</button>
	{#if alert}<p class="alert" role="status">{alert}</p>{/if}
	{#if variant === 'loaded'}<pre>{body}</pre>{/if}
</section>

<style>
	.card { display: grid; gap: var(--space-2); width: min(40rem, 100%); margin: var(--space-4) auto; padding: var(--space-4); background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); }
	h1, p { margin: 0; }
	.sub { color: var(--color-muted); }
	.alert { color: var(--color-danger); }
	pre { overflow: auto; white-space: pre-wrap; }
	button { font: inherit; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius); background: var(--color-accent); color: var(--color-accent-fg); }
</style>
