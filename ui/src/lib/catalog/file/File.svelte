<script lang="ts">
	import {
		canMoveInto,
		ROLE_LABELS,
		kindLabel,
		nameProblem,
		usagePercent,
		type DriveCrumb,
		type DriveNode,
		type DriveShare,
		type DriveUsage,
		type ShareRole,
		type UploadState
	} from '$lib/adapter/drive-call';
	import { docTitle } from '$lib/adapter/docs-call';
	import { formatValue } from '$lib/shippin/dashboard/stats-call';

	type Props = {
		title: string;
		items: readonly DriveNode[];
		crumbs: readonly DriveCrumb[];
		folders: ReadonlyMap<string, DriveNode>;
		usage: DriveUsage | null;
		uploads: readonly UploadState[];
		notice: string;
		problem: string;
		search: string;
		scope: 'mine' | 'shared';
		canAdd: boolean;
		canSearch: boolean;
		canMoveToTop: boolean;
		selfId: string;
		onopen?: (node: DriveCrumb | DriveNode) => void;
		onloadshares?: (node: DriveNode) => Promise<DriveShare[]>;
		onfindperson?: (email: string) => Promise<{ id: string; name: string } | null>;
		onsaveshares?: (node: DriveNode, shares: DriveShare[]) => Promise<boolean>;
		onupload?: (files: File[]) => void;
		onnewfolder?: (name: string) => Promise<boolean>;
		onrename?: (node: DriveNode, name: string) => Promise<boolean>;
		onmove?: (node: DriveNode, target: string | null) => Promise<boolean>;
		ondelete?: (node: DriveNode) => Promise<boolean>;
		ondownload?: (node: DriveNode) => void;
		onactivate?: (node: DriveNode) => void;
		oncopytogoogle?: (node: DriveNode) => void;
		onsearch?: (text: string) => void;
		onclearuploads?: () => void;
	};

	let {
		title,
		items,
		crumbs,
		folders,
		usage,
		uploads,
		notice,
		problem,
		search,
		scope,
		canAdd,
		canSearch,
		canMoveToTop,
		selfId,
		onopen,
		onloadshares,
		onfindperson,
		onsaveshares,
		onupload,
		onnewfolder,
		onrename,
		onmove,
		ondelete,
		ondownload,
		onactivate,
		oncopytogoogle,
		onsearch,
		onclearuploads
	}: Props = $props();

	type Mode =
		| { kind: 'idle' }
		| { kind: 'new-folder' }
		| { kind: 'rename'; id: string }
		| { kind: 'move'; id: string }
		| { kind: 'delete'; id: string }
		| { kind: 'share'; id: string };

	let mode = $state<Mode>({ kind: 'idle' });
	let draft = $state('');
	let target = $state('');
	let formError = $state('');
	let dragging = $state(false);
	let picker = $state<HTMLInputElement | null>(null);
	let term = $state('');
	let shares = $state<DriveShare[]>([]);
	let sharesLoading = $state(false);
	let shareEmail = $state('');
	let shareRole = $state<ShareRole>('viewer');

	$effect(() => {
		term = search;
	});

	async function beginShare(node: DriveNode) {
		begin({ kind: 'share', id: node.id });
		shares = [];
		shareEmail = '';
		shareRole = 'viewer';
		sharesLoading = true;
		try {
			shares = (await onloadshares?.(node)) ?? [];
		} catch {
			formError = 'Sharing could not be loaded.';
		}
		sharesLoading = false;
	}

	async function storeShares(node: DriveNode, next: DriveShare[]) {
		formError = '';
		if (await onsaveshares?.(node, next)) shares = next;
	}

	async function addShare(event: SubmitEvent, node: DriveNode) {
		event.preventDefault();
		const email = shareEmail.trim();
		if (!email) {
			formError = 'Enter their address.';
			return;
		}
		formError = '';
		const person = await onfindperson?.(email);
		if (!person) {
			formError = 'No one with that address on your domain.';
			return;
		}
		if (person.id === selfId) {
			formError = 'That is you.';
			return;
		}
		if (shares.some((share) => share.principalId === person.id)) {
			formError = 'They already have access.';
			return;
		}
		await storeShares(node, [...shares, { principalId: person.id, name: person.name, role: shareRole }]);
		if (!formError) shareEmail = '';
	}

	const searching = $derived(search.trim().length > 0);
	const isSharedRoot = $derived(scope === 'shared' && !canSearch);
	const percent = $derived(usagePercent(usage));
	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	function modified(value: string): string {
		const at = new Date(value);
		return Number.isNaN(at.getTime()) ? '' : dateFormat.format(at);
	}

	function begin(next: Mode, text = '') {
		mode = next;
		draft = text;
		target = '';
		formError = '';
	}

	function cancel() {
		begin({ kind: 'idle' });
	}

	/** Folders something can move into, with their depth for indenting, in tree order. */
	function destinations(node: DriveNode): { id: string; label: string }[] {
		const all = [...folders.values()];
		const out: { id: string; label: string }[] = [];
		const walk = (parent: string | null, depth: number) => {
			for (const folder of all.filter((item) => item.parentId === parent)) {
				if (folder.id === node.id) continue;
				if (canMoveInto(node, folder.id, folders)) out.push({ id: folder.id, label: `${' '.repeat(depth)}${folder.name}` });
				walk(folder.id, depth + 1);
			}
		};
		walk(null, 0);
		return out;
	}

	async function submitNewFolder(event: SubmitEvent) {
		event.preventDefault();
		formError = nameProblem(draft);
		if (formError) return;
		if (await onnewfolder?.(draft)) cancel();
	}

	async function submitRename(event: SubmitEvent, node: DriveNode) {
		event.preventDefault();
		formError = nameProblem(draft);
		if (formError) return;
		if (draft.trim() === node.name || (await onrename?.(node, draft))) cancel();
	}

	async function submitMove(event: SubmitEvent, node: DriveNode) {
		event.preventDefault();
		const destination = target === '' ? null : target;
		if (!canMoveInto(node, destination, folders)) {
			formError = 'It is already there.';
			return;
		}
		if (await onmove?.(node, destination)) cancel();
	}

	async function confirmDelete(node: DriveNode) {
		if (await ondelete?.(node)) cancel();
	}

	function picked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) onupload?.([...input.files]);
		input.value = '';
	}

	function dropped(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length && !searching && canAdd) onupload?.(files);
	}

	function dragOver(event: DragEvent) {
		if (![...(event.dataTransfer?.types ?? [])].includes('Files') || searching || !canAdd) return;
		event.preventDefault();
		dragging = true;
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		onsearch?.(term);
	}
</script>

<section class="drive">
	<header class="top">
		<h1>{title}</h1>
		<div class="tools">
			{#if canSearch}
				<form class="search" role="search" onsubmit={submitSearch}>
					<label class="sr" for="drive-search">Search Drive</label>
					<input id="drive-search" type="search" placeholder="Search by name" bind:value={term} />
					<button type="submit">Search</button>
					{#if searching}
						<button
							type="button"
							onclick={() => {
								term = '';
								onsearch?.('');
							}}>Clear</button
						>
					{/if}
				</form>
			{/if}
			{#if !searching && canAdd}
				<button type="button" onclick={() => begin({ kind: 'new-folder' })}>New folder</button>
				<button type="button" class="primary" onclick={() => picker?.click()}>Upload</button>
				<input class="sr" type="file" multiple aria-label="Choose files to upload" bind:this={picker} onchange={picked} tabindex="-1" />
			{/if}
		</div>
	</header>

	<nav class="tabs" aria-label="Drive sections">
		<a href="/files" aria-current={scope === 'mine' ? 'page' : undefined}>My Drive</a>
		<a href="/files?view=shared" aria-current={scope === 'shared' ? 'page' : undefined}>Shared with me</a>
		<a href="/files?view=google">Google Drive</a>
	</nav>

	{#if usage && scope === 'mine'}
		<div class="usage">
			<span>
				{formatValue(usage.used, 'bytes')} used{#if usage.limit} of {formatValue(usage.limit, 'bytes')}{/if}
			</span>
			{#if percent !== null}
				<div class="meter" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
					<div class="fill" style:width="{percent}%"></div>
				</div>
			{/if}
		</div>
	{/if}

	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to see your files.</p>
	{:else if notice}
		<p role="status">{notice}</p>
	{:else}
		{#if searching}
			<p class="path">Results for "{search}"</p>
		{:else}
			<nav class="path" aria-label="Folder path">
				<ol>
					{#each crumbs as crumb, index (crumb.id ?? 'root')}
						<li>
							{#if index === crumbs.length - 1}
								<span aria-current="page">{crumb.name}</span>
							{:else}
								<button type="button" class="link" onclick={() => onopen?.(crumb)}>{crumb.name}</button>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>
		{/if}

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		{#if uploads.length}
			<section class="uploads" aria-label="Uploads">
				<ul>
					{#each uploads as upload (upload.id)}
						<li data-state={upload.status}>
							<span class="name">{upload.name}</span>
							{#if upload.status === 'failed'}
								<span class="failed">{upload.error}</span>
							{:else if upload.status === 'done'}
								<span>Uploaded</span>
							{:else}
								<progress max={upload.size || 1} value={upload.sent} aria-label="Uploading {upload.name}"></progress>
							{/if}
						</li>
					{/each}
				</ul>
				{#if uploads.every((upload) => upload.status !== 'uploading')}
					<button type="button" class="link" onclick={() => onclearuploads?.()}>Clear list</button>
				{/if}
			</section>
		{/if}

		{#if mode.kind === 'new-folder'}
			<form class="inline" onsubmit={submitNewFolder}>
				<label>
					<span>Folder name</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={draft} autofocus />
				</label>
				<button type="submit" class="primary">Create folder</button>
				<button type="button" onclick={cancel}>Cancel</button>
				{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
			</form>
		{/if}

		<div
			class="zone"
			class:dragging
			role="group"
			aria-label="Files"
			ondragover={dragOver}
			ondragleave={() => (dragging = false)}
			ondrop={dropped}
		>
			{#if items.length === 0}
				<p class="empty">
					{#if searching}
						Nothing matches that name.
					{:else if isSharedRoot}
						Nothing has been shared with you yet.
					{:else if canAdd}
						Nothing here yet. Upload a file or drop one on this page.
					{:else}
						This folder is empty.
					{/if}
				</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col" class="wide">{isSharedRoot ? 'Shared by' : 'Kind'}</th>
							<th scope="col" class="num">Size</th>
							<th scope="col" class="wide">Modified</th>
							<th scope="col"><span class="sr">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each items as node (node.id)}
							<tr>
								<th scope="row">
									{#if node.kind === 'folder'}
										<button type="button" class="link name" onclick={() => onopen?.(node)}>
											<span aria-hidden="true">📁</span>
											{node.name}
										</button>
									{:else}
										<button type="button" class="link name" onclick={() => onactivate?.(node)}>
											<span aria-hidden="true">📄</span>
											{docTitle(node.name)}
										</button>
									{/if}
									{#if node.shared && scope === 'mine'}<span class="badge">Shared</span>{/if}
								</th>
								<td class="wide">{node.owner ?? kindLabel(node)}</td>
								<td class="num">{node.kind === 'folder' ? '' : formatValue(node.size, 'bytes')}</td>
								<td class="wide">{modified(node.modified)}</td>
								<td class="actions">
									{#if node.kind === 'file'}
										<button type="button" aria-label="Download {node.name}" onclick={() => ondownload?.(node)}>Download</button>
									{/if}
									{#if node.kind === 'file' && oncopytogoogle}
										<button type="button" aria-label="Copy {node.name} to Google" onclick={() => oncopytogoogle?.(node)}>To Google</button>
									{/if}
									{#if node.rights.share}
										<button type="button" aria-label="Share {node.name}" onclick={() => beginShare(node)}>Share</button>
									{/if}
									{#if node.rights.rename}
										<button type="button" aria-label="Rename {node.name}" onclick={() => begin({ kind: 'rename', id: node.id }, node.name)}>Rename</button>
										<button type="button" aria-label="Move {node.name}" onclick={() => begin({ kind: 'move', id: node.id })}>Move</button>
									{/if}
									{#if node.rights.remove}
										<button type="button" aria-label="Delete {node.name}" onclick={() => begin({ kind: 'delete', id: node.id })}>Delete</button>
									{/if}
								</td>
							</tr>
							{#if mode.kind !== 'idle' && mode.kind !== 'new-folder' && mode.id === node.id}
								<tr class="editing">
									<td colspan="5">
										{#if mode.kind === 'rename'}
											<form class="inline" onsubmit={(event) => submitRename(event, node)}>
												<label>
													<span>New name</span>
													<!-- svelte-ignore a11y_autofocus -->
													<input bind:value={draft} autofocus />
												</label>
												<button type="submit" class="primary">Save name</button>
												<button type="button" onclick={cancel}>Cancel</button>
												{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
											</form>
										{:else if mode.kind === 'move'}
											<form class="inline" onsubmit={(event) => submitMove(event, node)}>
												<label>
													<span>Move to</span>
													<select bind:value={target}>
														{#if canMoveToTop}<option value="">My Drive</option>{/if}
														{#each destinations(node) as place (place.id)}
															<option value={place.id}>{place.label}</option>
														{/each}
													</select>
												</label>
												<button type="submit" class="primary">Move here</button>
												<button type="button" onclick={cancel}>Cancel</button>
												{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
											</form>
										{:else if mode.kind === 'share'}
											<div class="sharing">
												<h2>Share {node.name}</h2>
												{#if node.kind === 'folder'}<p class="hint">Sharing a folder shares everything inside it.</p>{/if}
												{#if sharesLoading}
													<p role="status">Loading…</p>
												{:else if shares.length === 0}
													<p class="hint">Only you can see this.</p>
												{:else}
													<ul aria-label="People with access">
														{#each shares as share (share.principalId)}
															<li>
																<span>{share.name}</span>
																<label>
																	<span class="sr">Access for {share.name}</span>
																	<select
																		value={share.role}
																		onchange={(event) =>
																			storeShares(
																				node,
																				shares.map((item) =>
																					item.principalId === share.principalId
																						? { ...item, role: event.currentTarget.value as ShareRole }
																						: item
																				)
																			)}
																	>
																		<option value="viewer">{ROLE_LABELS.viewer}</option>
																		<option value="editor">{ROLE_LABELS.editor}</option>
																	</select>
																</label>
																<button
																	type="button"
																	aria-label="Remove {share.name}"
																	onclick={() => storeShares(node, shares.filter((item) => item.principalId !== share.principalId))}
																	>Remove</button
																>
															</li>
														{/each}
													</ul>
												{/if}
												<form class="inline" onsubmit={(event) => addShare(event, node)}>
													<label>
														<span>Their address</span>
														<!-- svelte-ignore a11y_autofocus -->
														<input type="email" bind:value={shareEmail} autofocus />
													</label>
													<label>
														<span>Access</span>
														<select bind:value={shareRole}>
															<option value="viewer">{ROLE_LABELS.viewer}</option>
															<option value="editor">{ROLE_LABELS.editor}</option>
														</select>
													</label>
													<button type="submit" class="primary">Share</button>
													<button type="button" onclick={cancel}>Done</button>
												</form>
												{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
											</div>
										{:else}
											<div class="inline">
												<p role="alert">
													Delete {node.name}{node.kind === 'folder' ? ' and everything in it' : ''}? This cannot be undone.
												</p>
												<button type="button" class="danger" onclick={() => confirmDelete(node)}>Delete for good</button>
												<button type="button" onclick={cancel}>Cancel</button>
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
</section>

<style>
	.drive {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-2);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		min-width: 0;
	}
	h1, p, ol, ul { margin: 0; }
	h1 { color: var(--color-brand); }
	.top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2); }
	.tools, .search, .inline { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); }
	.inline label { display: grid; gap: 0.25rem; }
	.inline label span { color: var(--color-muted); font-size: 0.875rem; }
	input, select, button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
	}
	button { cursor: pointer; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	button.link {
		min-height: 2.75rem;
		padding: 0;
		border: 0;
		background: none;
		text-align: start;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	h2 { font-size: 1rem; margin: 0; }
	.tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--color-border); }
	.tabs a { padding: 0.5rem 0.25rem; min-height: 2.75rem; display: inline-flex; align-items: center; color: var(--color-text); text-decoration: none; border-bottom: 2px solid transparent; }
	.tabs a[aria-current='page'] { border-bottom-color: var(--color-accent); font-weight: 600; }
	.badge { margin-inline-start: 0.5rem; padding: 0 0.375rem; border: 1px solid var(--color-border); border-radius: var(--radius); font-size: 0.75rem; color: var(--color-muted); }
	.hint { color: var(--color-muted); font-size: 0.875rem; }
	.sharing { display: grid; gap: var(--space-2); }
	.sharing ul { display: grid; gap: 0.25rem; padding: 0; list-style: none; }
	.sharing li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	.usage { display: grid; gap: 0.25rem; color: var(--color-muted); font-size: 0.875rem; max-width: 24rem; }
	.meter { height: 0.5rem; border-radius: 999px; background: var(--color-border); overflow: hidden; }
	.fill { height: 100%; background: var(--color-accent); }
	.path ol { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; padding: 0; list-style: none; }
	.path li + li::before { content: '/'; color: var(--color-muted); margin-inline-end: 0.5rem; }
	.problem { font-weight: 600; }
	.failed { font-weight: 600; }
	.uploads { display: grid; gap: var(--space-2); justify-items: start; }
	.uploads ul { display: grid; gap: 0.25rem; padding: 0; list-style: none; width: 100%; }
	.uploads li { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
	.uploads .name { font-weight: 600; overflow-wrap: anywhere; }
	.zone { border: 2px dashed transparent; border-radius: var(--radius); min-height: 8rem; overflow-x: auto; }
	.zone.dragging { border-color: var(--color-accent); }
	.empty { padding: var(--space-4); color: var(--color-muted); text-align: center; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border); text-align: start; vertical-align: middle; }
	thead th { color: var(--color-muted); font-size: 0.875rem; font-weight: 600; }
	th[scope='row'] { font-weight: normal; min-width: 12rem; }
	.name { overflow-wrap: anywhere; }
	.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.25rem; justify-content: flex-end; }
	.actions button { min-height: 2.75rem; }
	.editing td { background: var(--color-bg); }
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	@media (max-width: 48rem) {
		.wide { display: none; }
	}
</style>
