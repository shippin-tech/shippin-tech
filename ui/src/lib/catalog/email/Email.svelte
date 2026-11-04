<script lang="ts">
	type Message = { subject: string; preview: string; from: string };
	type Props = { message: Message | null; notice: string };
	let { message, notice }: Props = $props();
</script>

<section class="reader">
	<header>
		<p class="brand">Mail</p>
		<h1>{message?.subject ?? 'Message'}</h1>
	</header>
	{#if notice}
		<p>{notice}</p>
	{:else if message}
		<p class="from">{message.from}</p>
		<p>{message.preview || 'This message has no preview.'}</p>
	{:else}
		<p>No message is open.</p>
	{/if}
</section>

<style>
	.reader {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.brand { margin: 0; color: var(--color-brand); font-weight: 650; }
	h1, p { margin: 0; }
	p { color: var(--color-muted); }
	.from { color: var(--color-text); }
</style>
