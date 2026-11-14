<script lang="ts">
	import { docTitle, titleProblem } from '$lib/adapter/docs-call';
	import type { DriveNode } from '$lib/adapter/drive-call';

	type Props = {
		documents: readonly DriveNode[];
		notice: string;
		problem: string;
		onnew: (title: string) => Promise<boolean>;
		onopen: (node: DriveNode) => void;
		onrename: (node: DriveNode, title: string) => Promise<boolean>;
		ondelete: (node: DriveNode) => Promise<boolean>;
	};

	let { documents, notice, problem, onnew, onopen, onrename, ondelete }: Props = $props();

	type Mode = { kind: 'idle' } | { kind: 'new' } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string };

	let mode = $state<Mode>({ kind: 'idle' });
	let draft = $state('');
	let formError = $state('');

	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	function modified(value: string): string {
		const at = new Date(value);
		return Number.isNaN(at.getTime()) ? '' : dateFormat.format(at);
	}

	function begin(next: Mode, text = '') {
		mode = next;
		draft = text;
		formError = '';
	}

	async function submitNew(event: SubmitEvent) {
		event.preventDefault();
		formError = titleProblem(draft);
		if (formError) return;
		if (await onnew(draft.trim())) begin({ kind: 'idle' });
	}

	async function submitRename(event: SubmitEvent, node: DriveNode) {
		event.preventDefault();
		formError = titleProblem(draft);
		if (formError) return;
		if (await onrename(node, draft.trim())) begin({ kind: 'idle' });
	}

	async function confirmDelete(node: DriveNode) {
		if (await ondelete(node)) begin({ kind: 'idle' });
	}
</script>

<section class="docs">
	<header class="top">
		<h1>Docs</h1>
		{#if !notice}<button type="button" class="primary" onclick={() => begin({ kind: 'new' })}>New document</button>{/if}
	</header>

	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to see your documents.</p>
	{:else if notice}
		<p role="status">{notice}</p>
	{:else}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		{#if mode.kind === 'new'}
			<form class="inline" onsubmit={submitNew}>
				<label>
					<span>Title</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={draft} autofocus />
				</label>
				<button type="submit" class="primary">Create document</button>
				<button type="button" onclick={() => begin({ kind: 'idle' })}>Cancel</button>
				{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
			</form>
		{/if}
		{#if documents.length === 0}
			<p class="empty">No documents yet. Press New document to write your first one.</p>
		{:else}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Title</th>
							<th scope="col" class="wide">Owner</th>
							<th scope="col" class="wide">Last changed</th>
							<th scope="col"><span class="sr">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each documents as node (`${node.drive ?? 'mine'}-${node.id}`)}
							{@const title = docTitle(node.name)}
							<tr>
								<th scope="row"><button type="button" class="link" onclick={() => onopen(node)}>{title}</button></th>
								<td class="wide">{node.owner ?? 'You'}</td>
								<td class="wide">{modified(node.modified)}</td>
								<td class="actions">
									{#if node.rights.rename}
										<button type="button" aria-label="Rename {title}" onclick={() => begin({ kind: 'rename', id: node.id }, title)}>Rename</button>
									{/if}
									{#if node.rights.remove}
										<button type="button" aria-label="Delete {title}" onclick={() => begin({ kind: 'delete', id: node.id })}>Delete</button>
									{/if}
								</td>
							</tr>
							{#if (mode.kind === 'rename' || mode.kind === 'delete') && mode.id === node.id}
								<tr>
									<td colspan="4">
										{#if mode.kind === 'rename'}
											<form class="inline" onsubmit={(event) => submitRename(event, node)}>
												<label>
													<span>New title</span>
													<!-- svelte-ignore a11y_autofocus -->
													<input bind:value={draft} autofocus />
												</label>
												<button type="submit" class="primary">Save title</button>
												<button type="button" onclick={() => begin({ kind: 'idle' })}>Cancel</button>
												{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
											</form>
										{:else}
											<div class="inline">
												<p role="alert">Delete {title}? This cannot be undone.</p>
												<button type="button" class="danger" onclick={() => confirmDelete(node)}>Delete for good</button>
												<button type="button" onclick={() => begin({ kind: 'idle' })}>Cancel</button>
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</section>

<style>
	.docs { min-height: 22rem; padding: var(--space-4); display: grid; gap: var(--space-2); align-content: start; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); min-width: 0; }
	h1, p { margin: 0; }
	h1 { color: var(--color-brand); }
	.top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2); }
	.inline { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); }
	.inline label { display: grid; gap: 0.25rem; }
	.inline span { color: var(--color-muted); font-size: 0.875rem; }
	input, button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); }
	button { cursor: pointer; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	button.link { border: 0; background: none; padding: 0; text-align: start; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
	.problem { font-weight: 600; }
	.empty { color: var(--color-muted); }
	.scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border); text-align: start; vertical-align: middle; }
	thead th { color: var(--color-muted); font-size: 0.875rem; }
	th[scope='row'] { font-weight: normal; min-width: 12rem; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.25rem; justify-content: flex-end; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (max-width: 48rem) { .wide { display: none; } }
</style>
