<script lang="ts">
	import { layouts, views } from '$lib/portal/catalog';
	import { buildSearchIndex, groupSearch, querySearch, searchLabel, searchTitle } from '$lib/portal/search';

	const index = buildSearchIndex(layouts, views);

	let open = $state(false);
	let query = $state('');
	let shortcut = $state('Ctrl K');
	let dialog = $state<HTMLDialogElement | null>(null);

	const hits = $derived(querySearch(index, query));
	const groups = $derived(groupSearch(hits));

	$effect(() => {
		const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
		shortcut = mac ? '⌘K' : 'Ctrl K';
	});

	$effect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				if (!open) return;
				event.preventDefault();
				open = false;
				return;
			}
			if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				open = !open;
			}
		}
		document.addEventListener('keydown', onKey, true);
		return () => document.removeEventListener('keydown', onKey, true);
	});

	$effect(() => {
		const node = dialog;
		if (!node) return;
		if (open && !node.open) {
			node.showModal();
			node.querySelector('input')?.focus();
		}
		if (!open && node.open) node.close();
	});

	function closed() {
		open = false;
		query = '';
	}
</script>

<button type="button" class="launch" onclick={() => (open = true)}>
	<span>Search pages, fields, settings...</span>
	<kbd>{shortcut}</kbd>
</button>

<dialog bind:this={dialog} aria-label="Search" onclose={closed}>
	<label>
		<span class="sr">Search</span>
		<input placeholder="Search pages, fields, settings..." bind:value={query} />
		<kbd>ESC</kbd>
	</label>
	{#if hits.length === 0}
		<p>{query.trim() ? 'No results found.' : 'Type to search the admin panel.'}</p>
	{:else}
		{#each groups as group (group.type)}
			<section>
				<h2>{group.heading}</h2>
				<ul>
					{#each group.entries as entry (`${entry.type}|${entry.viewName}|${entry.breadcrumb}|${entry.text}`)}
						<li>
							<a href="/portal/{entry.viewName}" onclick={() => (open = false)}>
								<span class="title">{searchTitle(entry.text)}</span>
								<span class="crumb">{entry.breadcrumb}</span>
								<span class="badge">{searchLabel(entry)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</dialog>

<style>
	.launch {
		min-height: 2.75rem;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--x-2xs);
		padding-inline: var(--x-2xs);
		background: var(--color-card);
		color: var(--color-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
		text-align: start;
	}
	kbd {
		font-family: var(--font-display);
		color: var(--color-muted);
	}
	dialog {
		width: min(100% - var(--x-s), 40rem);
		max-block-size: min(70vh, 36rem);
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		padding: var(--y-s);
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--color-text) 45%, transparent);
	}
	label {
		display: flex;
		align-items: center;
		gap: var(--x-2xs);
		margin-block-end: var(--y-2xs);
	}
	input {
		flex: 1;
		min-height: 2.75rem;
		min-inline-size: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-input);
		color: var(--color-text);
		padding-inline: var(--x-2xs);
	}
	.launch:focus-visible,
	input:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.sr {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	h2 {
		margin: var(--y-2xs) 0 0;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	a {
		min-height: 2.75rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: var(--x-2xs);
		align-items: center;
		color: var(--color-text);
		text-decoration: none;
	}
	.title { font-weight: 650; }
	.crumb {
		grid-column: 1;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		grid-row: 1 / span 2;
		grid-column: 2;
		color: var(--color-muted);
	}
	@media (prefers-reduced-motion: reduce) {
		.launch, a { transition: none; }
	}
</style>
