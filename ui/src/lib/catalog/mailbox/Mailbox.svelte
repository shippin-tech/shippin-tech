<script lang="ts">
	const folders = ['Inbox', 'Drafts', 'Sent', 'Junk', 'Trash'];
</script>

<section class="mail">
	<aside>
		<h1>Mail</h1>
		<ul>
			{#each folders as folder, index}
				<li><button type="button" aria-current={index === 0 ? 'page' : undefined}>{folder}</button></li>
			{/each}
		</ul>
	</aside>
	<div class="pane">
		<h2>Inbox</h2>
		<p>No messages yet.</p>
	</div>
</section>

<style>
	.mail {
		display: grid;
		grid-template-columns: 12rem 1fr;
		min-height: 22rem;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	aside {
		padding: var(--space-3);
		border-right: 1px solid var(--color-border);
		background: var(--color-bg);
	}
	h1, h2, p { margin: 0; }
	h1 { color: var(--color-brand); font-size: 1.1rem; }
	ul { list-style: none; padding: 0; margin: var(--space-3) 0 0; display: grid; gap: var(--space-1); }
	button {
		width: 100%;
		text-align: left;
		background: transparent;
		color: var(--color-text);
		border: 0;
		border-radius: var(--radius);
		padding: var(--space-2);
	}
	button[aria-current='page'] { background: var(--color-accent); color: var(--color-accent-fg); }
	.pane { padding: var(--space-4); display: grid; gap: var(--space-2); align-content: start; }
	p { color: var(--color-muted); }
	@media (max-width: 700px) {
		.mail { grid-template-columns: 1fr; }
		aside { border-right: 0; border-bottom: 1px solid var(--color-border); }
	}
</style>
