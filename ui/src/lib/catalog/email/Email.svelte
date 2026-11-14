<script lang="ts">
	type Attachment = { blobId: string; name: string; type: string; size: number };
	type Message = {
		id?: string;
		subject: string;
		preview?: string;
		from: string;
		to?: string;
		receivedAt?: string;
		body: string | null;
		truncated: boolean;
		attachments?: Attachment[];
		draft?: boolean;
	};
	type Props = { message: Message | null; notice: string; ondownload?: (attachment: Attachment) => Promise<void> };
	let { message, notice, ondownload }: Props = $props();

	let failed = $state('');

	async function download(attachment: Attachment) {
		failed = '';
		try {
			await ondownload?.(attachment);
		} catch (err) {
			failed = err instanceof Error ? err.message : `${attachment.name} could not be downloaded.`;
		}
	}

	const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
	const link = (kind: string, id: string) => `/mail/compose?${kind}=${encodeURIComponent(id)}`;
</script>

<section class="reader">
	<header>
		<a href="/mail">← Back to mail</a>
		<p class="brand">Mail</p>
		<h1>{message?.subject || 'Message'}</h1>
	</header>
	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to read this message.</p>
	{:else if notice}
		<p>{notice}</p>
	{:else if message}
		{#if message.id}
			<nav class="actions" aria-label="Message actions">
				{#if message.draft}
					<a class="button" href={link('draft', message.id)}>Edit draft</a>
				{:else}
					<a class="button" href={link('reply', message.id)}>Reply</a>
					<a class="button secondary" href={`${link('reply', message.id)}&all=1`}>Reply all</a>
					<a class="button secondary" href={link('forward', message.id)}>Forward</a>
				{/if}
			</nav>
		{/if}
		<p class="from">{message.from}</p>
		{#if message.to}<p>To {message.to}</p>{/if}
		{#if message.receivedAt}<p>{new Date(message.receivedAt).toLocaleString()}</p>{/if}
		{#if message.body !== null}
			<div class="body">{message.body}</div>
			{#if message.truncated}<p>Only part of this message is shown.</p>{/if}
		{:else}
			<p>{message.preview || 'This message has no plain-text content.'}</p>
			<p>Plain-text body unavailable; showing the message preview.</p>
		{/if}
		{#if message.attachments?.length}
			<ul class="attachments" aria-label="Attachments">
				{#each message.attachments as attachment, index (attachment.blobId + index)}
					<li>
						<button type="button" class="link" onclick={() => download(attachment)}>{attachment.name}</button>
						<span>{size(attachment.size)}</span>
					</li>
				{/each}
			</ul>
			{#if failed}<p role="alert">{failed}</p>{/if}
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
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.button { min-height: 2.75rem; display: inline-flex; align-items: center; padding: 0 var(--space-3); border-radius: var(--radius); background: var(--color-accent); color: var(--color-accent-fg); text-decoration: none; border: 1px solid transparent; }
	.button.secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
	.attachments { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.attachments li { display: flex; gap: var(--space-1); align-items: center; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); }
	.attachments span { color: var(--color-muted); }
	button.link { font: inherit; background: transparent; border: 0; color: var(--color-text); text-decoration: underline; cursor: pointer; padding: 0; }
</style>
