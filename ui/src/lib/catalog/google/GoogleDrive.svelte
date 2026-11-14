<script lang="ts">
	import {
		EXPORT_LABELS,
		IMPORT_FOLDER,
		googleKind,
		isFolder,
		isGoogleDocument,
		type GoogleFile,
		type GoogleStatus
	} from '$lib/adapter/google-call';
	import { formatValue } from '$lib/shippin/dashboard/stats-call';

	type Crumb = { id: string; name: string };

	type Props = {
		status: GoogleStatus | null;
		notice: string;
		problem: string;
		done: string;
		files: readonly GoogleFile[];
		path: readonly Crumb[];
		section: 'mine' | 'shared';
		search: string;
		more: boolean;
		busy: ReadonlySet<string>;
		onconnect: () => void;
		ondisconnect: () => void;
		onsection: (section: 'mine' | 'shared') => void;
		onopen: (file: GoogleFile) => void;
		oncrumb: (index: number) => void;
		onsearch: (text: string) => void;
		onmore: () => void;
		onimport: (file: GoogleFile, format?: string) => void;
		ondownload: (file: GoogleFile, format?: string) => void;
	};

	let {
		status,
		notice,
		problem,
		done,
		files,
		path,
		section,
		search,
		more,
		busy,
		onconnect,
		ondisconnect,
		onsection,
		onopen,
		oncrumb,
		onsearch,
		onmore,
		onimport,
		ondownload
	}: Props = $props();

	let term = $state('');
	let confirming = $state(false);
	let formats = $state<Record<string, string>>({});

	$effect(() => {
		term = search;
	});

	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	function modified(value: string): string {
		const at = new Date(value);
		return Number.isNaN(at.getTime()) ? '' : dateFormat.format(at);
	}

	function formatOf(file: GoogleFile): string | undefined {
		return isGoogleDocument(file) ? (formats[file.id] ?? file.exports[0]) : undefined;
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		onsearch(term);
	}
</script>

<section class="google">
	<header class="top">
		<h1>Drive</h1>
	</header>

	<nav class="tabs" aria-label="Drive sections">
		<a href="/files">My Drive</a>
		<a href="/files?view=shared">Shared with me</a>
		<a href="/files?view=google" aria-current="page">Google Drive</a>
	</nav>

	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to use the Google link.</p>
	{:else if notice}
		<p role="status">{notice}</p>
	{:else if status && !status.available}
		<p>The Google link is not set up on this server yet. An administrator can turn it on; the steps are in <code>deploy/README.md</code>.</p>
	{:else if status && !status.connected}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		<p>Connect your Google account to see your Google Drive here and copy files in either direction. Your Google password never comes to this server.</p>
		<p><button type="button" class="primary" onclick={onconnect}>Connect Google account</button></p>
	{:else if status}
		<div class="account">
			<span>Connected as <strong>{status.email || 'your Google account'}</strong></span>
			{#if confirming}
				<span role="alert">Disconnect? Files already copied stay where they are.</span>
				<button type="button" class="danger" onclick={ondisconnect}>Disconnect</button>
				<button type="button" onclick={() => (confirming = false)}>Cancel</button>
			{:else}
				<button type="button" onclick={() => (confirming = true)}>Disconnect</button>
			{/if}
		</div>

		<div class="tools">
			<div class="group" role="group" aria-label="Google Drive section">
				<button type="button" aria-pressed={section === 'mine'} onclick={() => onsection('mine')}>My files</button>
				<button type="button" aria-pressed={section === 'shared'} onclick={() => onsection('shared')}>Shared with me</button>
			</div>
			<form class="group" role="search" onsubmit={submitSearch}>
				<label class="sr" for="google-search">Search Google Drive</label>
				<input id="google-search" type="search" placeholder="Search by name" bind:value={term} />
				<button type="submit">Search</button>
				{#if search}
					<button
						type="button"
						onclick={() => {
							term = '';
							onsearch('');
						}}>Clear</button
					>
				{/if}
			</form>
		</div>

		{#if path.length}
			<nav aria-label="Google folder path">
				<ol class="path">
					<li><button type="button" class="link" onclick={() => oncrumb(-1)}>{section === 'mine' ? 'My files' : 'Shared with me'}</button></li>
					{#each path as crumb, index (crumb.id)}
						<li>
							{#if index === path.length - 1}
								<span aria-current="page">{crumb.name}</span>
							{:else}
								<button type="button" class="link" onclick={() => oncrumb(index)}>{crumb.name}</button>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>
		{/if}

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		{#if done}<p role="status">{done}</p>{/if}

		{#if files.length === 0}
			<p class="empty">{search ? 'Nothing matches that name.' : 'Nothing here.'}</p>
		{:else}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col" class="wide">Kind</th>
							<th scope="col" class="num wide">Size</th>
							<th scope="col" class="wide">Modified</th>
							<th scope="col"><span class="sr">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each files as file (file.id)}
							<tr>
								<th scope="row">
									{#if isFolder(file)}
										<button type="button" class="link" onclick={() => onopen(file)}><span aria-hidden="true">📁</span> {file.name}</button>
									{:else}
										<span aria-hidden="true">📄</span> {file.name}
									{/if}
								</th>
								<td class="wide">{googleKind(file)}</td>
								<td class="num wide">{file.size === null ? '' : formatValue(file.size, 'bytes')}</td>
								<td class="wide">{modified(file.modified)}</td>
								<td class="actions">
									{#if !isFolder(file)}
										{#if isGoogleDocument(file) && file.exports.length > 1}
											<label>
												<span class="sr">Format for {file.name}</span>
												<select value={formatOf(file)} onchange={(event) => (formats[file.id] = event.currentTarget.value)}>
													{#each file.exports as format (format)}<option value={format}>{EXPORT_LABELS[format] ?? format}</option>{/each}
												</select>
											</label>
										{/if}
										<button type="button" disabled={busy.has(file.id)} aria-label="Copy {file.name} to my Drive" onclick={() => onimport(file, formatOf(file))}>
											{busy.has(file.id) ? 'Copying…' : 'Copy to my Drive'}
										</button>
										<button type="button" aria-label="Download {file.name}" onclick={() => ondownload(file, formatOf(file))}>Download</button>
									{/if}
									{#if file.webLink}
										<a href={file.webLink} target="_blank" rel="noopener noreferrer" aria-label="Open {file.name} in Google">Open in Google</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if more}<p><button type="button" onclick={onmore}>Show more</button></p>{/if}
		{/if}
		<p class="hint">Copies land in the {IMPORT_FOLDER} folder of your Drive and count against your storage.</p>
	{/if}
</section>

<style>
	.google { min-height: 22rem; padding: var(--space-4); display: grid; gap: var(--space-2); align-content: start; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); min-width: 0; }
	h1, p, ol { margin: 0; }
	h1 { color: var(--color-brand); }
	.tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--color-border); }
	.tabs a { padding: 0.5rem 0.25rem; min-height: 2.75rem; display: inline-flex; align-items: center; color: var(--color-text); text-decoration: none; border-bottom: 2px solid transparent; }
	.tabs a[aria-current='page'] { border-bottom-color: var(--color-accent); font-weight: 600; }
	.account, .tools, .group { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	.tools { justify-content: space-between; }
	input, select, button, .actions a { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); box-sizing: border-box; }
	.actions a { display: inline-flex; align-items: center; text-decoration: none; }
	button { cursor: pointer; }
	button.primary, button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	button.link { border: 0; background: none; padding: 0; text-align: start; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
	.path { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; padding: 0; list-style: none; }
	.path li + li::before { content: '/'; color: var(--color-muted); margin-inline-end: 0.5rem; }
	.problem { font-weight: 600; }
	.empty, .hint { color: var(--color-muted); }
	.hint { font-size: 0.875rem; }
	.scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border); text-align: start; vertical-align: middle; }
	thead th { color: var(--color-muted); font-size: 0.875rem; }
	th[scope='row'] { font-weight: normal; min-width: 12rem; overflow-wrap: anywhere; }
	.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.25rem; justify-content: flex-end; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (max-width: 48rem) { .wide { display: none; } }
</style>
