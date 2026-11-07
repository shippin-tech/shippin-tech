<script lang="ts">
	type Folder = { id: string; name: string; unread: number };
	type Message = { id: string; subject: string; preview: string; from: string };

	type Props = {
		folders: Folder[];
		messages: Message[];
		selectedId: string;
		notice: string;
		onselect: (id: string) => void;
	};

	let { folders, messages, selectedId, notice, onselect }: Props = $props();
	const selected = $derived(folders.find((folder) => folder.id === selectedId));
</script>

<section class="mail">
	<aside>
		<h1>Mail</h1>
		<ul>
			{#each folders as folder (folder.id)}
				<li>
					<button type="button" aria-current={folder.id === selectedId ? 'page' : undefined} onclick={() => onselect(folder.id)}>
						{folder.name}
						{#if folder.unread > 0}<span>{folder.unread}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	</aside>
	<div class="pane">
		<h2>{selected?.name ?? 'Mail'}</h2>
		{#if notice === 'sign-in required'}
			<p><a href="/login">Sign in</a> to see your mail.</p>
		{:else if notice}
			<p>{notice}</p>
		{:else if messages.length === 0}
			<p>No messages yet.</p>
		{:else}
			<ul class="messages">
				{#each messages as message (message.id)}
					<li>
						<a href={`/mail/email?id=${encodeURIComponent(message.id)}`}>
							<strong>{message.subject}</strong>
							<span>{message.from}</span>
							<small>{message.preview}</small>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.mail {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--aside)), 1fr));
		gap: var(--x-3xs);
		min-block-size: var(--y-3xl);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	aside {
		padding: var(--y-s) var(--x-s);
		background: var(--color-bg);
	}
	h1, h2, p { margin: 0; }
	h1 { color: var(--color-brand); }
	ul { list-style: none; padding: 0; margin: var(--space-3) 0 0; display: grid; gap: var(--space-1); }
	button, a {
		width: 100%;
		text-align: left;
		background: transparent;
		color: var(--color-text);
		border: 0;
		border-radius: var(--radius);
		padding: var(--space-2);
		text-decoration: none;
	}
	button { display: flex; justify-content: space-between; gap: var(--space-2); }
	button[aria-current='page'] { background: var(--color-accent); color: var(--color-accent-fg); }
	.pane { padding: var(--space-4); display: grid; gap: var(--space-2); align-content: start; }
	p, small, span { color: var(--color-muted); }
	.messages a { display: grid; gap: var(--space-1); border: 1px solid var(--color-border); background: var(--color-bg); }
	.messages strong { color: var(--color-text); }
</style>
