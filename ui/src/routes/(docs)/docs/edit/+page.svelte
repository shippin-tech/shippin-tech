<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import DocEditor from '$lib/catalog/doc/DocEditor.svelte';
	import {
		SAVE_LABELS,
		docFileName,
		docTitle,
		exportName,
		openDocument,
		saveDocument,
		saveToDevice,
		titleProblem,
		wordDocument,
		wrapDocument,
		type OpenDocument,
		type SaveState
	} from '$lib/adapter/docs';
	import { renameNode } from '$lib/adapter/drive';
	import { mcplEmit } from '$lib/mcpl/events';

	const AUTOSAVE_MS = 1000;

	let doc = $state<OpenDocument | null>(null);
	let notice = $state('Opening the document.');
	let title = $state('');
	let titleError = $state('');
	let saveState = $state<SaveState>('saved');
	let editor = $state<DocEditor | null>(null);
	let body = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving = false;
	let again = false;
	let announcedEdit = false;

	const editable = $derived(doc?.node.rights.modify === true);

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	function warnBeforeLeaving(event: BeforeUnloadEvent) {
		if (saveState === 'unsaved' || saveState === 'saving' || saveState === 'failed') event.preventDefault();
	}

	onMount(async () => {
		window.addEventListener('beforeunload', warnBeforeLeaving);
		const id = page.url.searchParams.get('id');
		if (!id) {
			notice = 'No document was chosen.';
			return;
		}
		try {
			doc = await openDocument(id, page.url.searchParams.get('drive') ?? undefined);
			title = docTitle(doc.node.name);
			body = doc.html;
			notice = '';
		} catch (err) {
			notice = message(err, 'The document could not be opened.');
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') window.removeEventListener('beforeunload', warnBeforeLeaving);
		if (timer) clearTimeout(timer);
		if (saveState === 'unsaved' || saveState === 'failed') void save();
	});

	async function save(force = false) {
		if (!doc) return;
		if (saving) {
			again = true;
			return;
		}
		saving = true;
		saveState = 'saving';
		try {
			const result = await saveDocument(doc, title.trim() || docTitle(doc.node.name), body, force);
			if (result.status === 'conflict') {
				saveState = 'conflict';
				again = false;
			} else {
				doc = { ...doc, node: result.node };
				saveState = again ? 'unsaved' : 'saved';
				if (!announcedEdit) {
					announcedEdit = true;
					mcplEmit('doc.document.edited', 'docs');
				}
			}
		} catch {
			saveState = 'failed';
		}
		saving = false;
		if (again) {
			again = false;
			schedule();
		}
	}

	function schedule() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void save(), AUTOSAVE_MS);
	}

	function changed(html: string) {
		body = html;
		if (saveState === 'conflict') return;
		saveState = 'unsaved';
		schedule();
	}

	async function commitTitle() {
		if (!doc) return;
		const next = title.trim();
		titleError = titleProblem(next);
		if (titleError || next === docTitle(doc.node.name)) return;
		try {
			await renameNode(doc.node.id, docFileName(next), doc.account);
			doc = { ...doc, node: { ...doc.node, name: docFileName(next) } };
			saveState = 'unsaved';
			schedule();
		} catch (err) {
			titleError = message(err, 'The title could not be changed.');
		}
	}

	function current(): string {
		return editor?.currentHtml() ?? body;
	}

	function exportAs(kind: 'html' | 'word') {
		const name = title.trim();
		if (kind === 'html') saveToDevice(wrapDocument(name, current()), 'text/html', exportName(name, 'html'));
		else saveToDevice(wordDocument(name, current()), 'application/msword', exportName(name, 'doc'));
		mcplEmit('doc.document.exported', 'docs', { format: kind });
	}
</script>

<svelte:head><title>{title || 'Document'}</title></svelte:head>

<section class="doc">
	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to open this document.</p>
	{:else if notice}
		<p role="status">{notice}</p>
		<p><a href="/docs">Back to Docs</a></p>
	{:else if doc}
		<header class="top no-print">
			<a href="/docs">Docs</a>
			<label class="title">
				<span class="sr">Document title</span>
				<input bind:value={title} onblur={commitTitle} readonly={!doc.node.rights.rename} aria-label="Document title" />
			</label>
			<p class="status" role="status">{editable ? SAVE_LABELS[saveState] : 'View only'}</p>
			<div class="exports" role="group" aria-label="Export">
				<button type="button" onclick={() => exportAs('html')}>Download HTML</button>
				<button type="button" onclick={() => exportAs('word')}>Download Word</button>
				<button
					type="button"
					onclick={() => {
						mcplEmit('doc.document.exported', 'docs', { format: 'print' });
						window.print();
					}}>Print or PDF</button
				>
			</div>
		</header>
		{#if titleError}<p class="problem no-print" role="alert">{titleError}</p>{/if}
		{#if saveState === 'conflict'}
			<div class="conflict no-print" role="alert">
				<p>Someone else saved this document after you opened it. Your changes are still on this page.</p>
				<button type="button" onclick={() => save(true)}>Keep my version</button>
				<button type="button" onclick={() => location.reload()}>Load their version</button>
			</div>
		{/if}
		<h1 class="print-title">{title}</h1>
		<DocEditor bind:this={editor} content={doc.html} {editable} onchange={changed} />
	{/if}
</section>

<style>
	.doc { padding: var(--space-4); display: grid; gap: var(--space-2); align-content: start; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); min-width: 0; }
	p { margin: 0; }
	.top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	.title { flex: 1 1 14rem; }
	.title input { width: 100%; box-sizing: border-box; font: inherit; font-size: 1.25rem; font-weight: 600; min-height: 2.75rem; padding: 0 0.5rem; border: 1px solid transparent; border-radius: var(--radius); background: transparent; color: var(--color-text); }
	.title input:hover, .title input:focus { border-color: var(--color-border); }
	.status { color: var(--color-muted); font-size: 0.875rem; }
	.exports { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); cursor: pointer; }
	.problem { font-weight: 600; }
	.conflict { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-2); border: 2px solid var(--color-text); border-radius: var(--radius); }
	.print-title { display: none; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media print {
		:global(body *) { visibility: hidden; }
		.doc, .doc :global(*) { visibility: visible; }
		.doc { position: absolute; inset: 0; border: 0; }
		.no-print, .doc :global([role='toolbar']) { display: none; }
		.print-title { display: block; }
	}
</style>
