<script lang="ts">
	type Message = { subject: string; preview: string; from: string; body: string | null; truncated: boolean };
	type Props = { message: Message | null; notice: string };
	let { message, notice }: Props = $props();
</script>

<section class="reader">
	<header>
		<a href="/mail">← Back to mail</a>
		<p class="brand">Mail</p>
		<h1>{message?.subject ?? 'Message'}</h1>
	</header>
	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to read this message.</p>
	{:else if notice}
		<p>{notice}</p>
	{:else if message}
		<p class="from">{message.from}</p>
		{#if message.body !== null}
			<div class="body">{message.body}</div>
			{#if message.truncated}<p>Only part of this message is shown.</p>{/if}
		{:else}
			<p>{message.preview || 'This message has no plain-text content.'}</p>
			<p>Plain-text body unavailable; showing the message preview.</p>
		{/if}
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
	.body { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
