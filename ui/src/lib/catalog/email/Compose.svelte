<script lang="ts">
	import { untrack } from 'svelte';
	import { draftProblem, type Attachment, type Draft } from '$lib/mail/compose';

	type Props = {
		draft: Draft;
		from: string;
		title: string;
		onsend: (draft: Draft) => Promise<void>;
		onsave: (draft: Draft) => Promise<string>;
		onupload: (file: File) => Promise<Attachment>;
		ondone: (outcome: 'sent' | 'saved' | 'discarded') => void;
	};

	let { draft, from, title, onsend, onsave, onupload, ondone }: Props = $props();

	// The form starts from the draft it was opened with and then owns its fields.
	const start = untrack(() => ({ ...draft }));
	let to = $state(start.to);
	let cc = $state(start.cc);
	let showCc = $state(start.cc.length > 0);
	let subject = $state(start.subject);
	let body = $state(start.body);
	let attachments = $state<Attachment[]>([...start.attachments]);
	let draftId = $state(start.draftId);
	let busy = $state<'' | 'send' | 'save' | 'upload'>('');
	let error = $state('');
	let saved = $state('');

	const current = (): Draft => ({ ...start, to, cc, subject, body, attachments, draftId });

	async function send(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const problem = draftProblem(current(), true);
		if (problem) {
			error = problem;
			return;
		}
		if (!subject.trim() && !confirm('Send without a subject?')) return;
		busy = 'send';
		try {
			await onsend(current());
			ondone('sent');
		} catch (err) {
			error = err instanceof Error ? err.message : 'The message was not sent.';
		} finally {
			busy = '';
		}
	}

	async function save() {
		error = '';
		const problem = draftProblem(current(), false);
		if (problem) {
			error = problem;
			return;
		}
		busy = 'save';
		try {
			draftId = await onsave(current());
			saved = `Saved to Drafts at ${new Date().toLocaleTimeString()}.`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'The draft was not saved.';
		} finally {
			busy = '';
		}
	}

	async function attach(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (!files.length) return;
		busy = 'upload';
		error = '';
		try {
			for (const file of files) attachments = [...attachments, await onupload(file)];
		} catch (err) {
			error = err instanceof Error ? err.message : 'The file could not be attached.';
		} finally {
			busy = '';
		}
	}

	function discard() {
		const touched = to || cc || subject || body.trim() || attachments.length;
		if (touched && !confirm('Discard this message?')) return;
		ondone('discarded');
	}

	const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
</script>

<form class="compose" onsubmit={send} novalidate aria-labelledby="compose-title">
	<header>
		<h1 id="compose-title">{title}</h1>
		<p class="muted">From {from}</p>
	</header>

	<label for="compose-to">To</label>
	<div class="row">
		<input id="compose-to" bind:value={to} autocomplete="email" multiple placeholder="name@example.com, another@example.org" />
		{#if !showCc}<button type="button" class="link" onclick={() => (showCc = true)}>Cc</button>{/if}
	</div>
	{#if showCc}
		<label for="compose-cc">Cc</label>
		<input id="compose-cc" bind:value={cc} autocomplete="email" multiple />
	{/if}
	<label for="compose-subject">Subject</label>
	<input id="compose-subject" bind:value={subject} />
	<label for="compose-body" class="sr-only">Message</label>
	<textarea id="compose-body" bind:value={body} rows="16"></textarea>

	{#if attachments.length}
		<ul class="attachments" aria-label="Attachments">
			{#each attachments as item, index (item.blobId + index)}
				<li>
					{item.name} <span class="muted">{size(item.size)}</span>
					<button type="button" class="link" aria-label="Remove {item.name}" onclick={() => (attachments = attachments.filter((_, i) => i !== index))}>Remove</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if error}<p class="alert" role="alert">{error}</p>{/if}
	{#if saved && !error}<p class="muted" role="status">{saved}</p>{/if}

	<div class="actions">
		<button type="submit" disabled={busy !== ''}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
		<label class="button secondary" aria-disabled={busy !== ''}>
			{busy === 'upload' ? 'Attaching…' : 'Attach files'}
			<input type="file" multiple onchange={attach} disabled={busy !== ''} />
		</label>
		<button type="button" class="secondary" onclick={save} disabled={busy !== ''}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
		<button type="button" class="secondary" onclick={discard} disabled={busy === 'send'}>Discard</button>
	</div>
</form>

<style>
	.compose { display: grid; gap: var(--space-2); max-inline-size: 56rem; margin-inline: auto; padding: var(--space-4); background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); }
	header h1 { margin: 0; }
	.muted { color: var(--color-muted); margin: 0; }
	label { font-weight: 600; }
	input, textarea { font: inherit; padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); min-inline-size: 0; }
	input { min-height: 2.75rem; }
	textarea { resize: vertical; min-block-size: 14rem; }
	.row { display: flex; gap: var(--space-2); align-items: center; }
	.row input { flex: 1; }
	.attachments { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.attachments li { padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); }
	.alert { margin: 0; padding: var(--space-2) var(--space-3); border-inline-start: 3px solid var(--color-danger); background: var(--color-bg); }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	button, .button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-3); border-radius: var(--radius); border: 1px solid transparent; background: var(--color-accent); color: var(--color-accent-fg); cursor: pointer; display: inline-flex; align-items: center; }
	.secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
	.button input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
	.button { position: relative; font-weight: 400; }
	.button:focus-within { outline: 2px solid var(--brand-accent, #22d3ee); outline-offset: 2px; }
	button.link { min-height: auto; padding: 0 var(--space-1); background: transparent; color: var(--color-text); text-decoration: underline; border: 0; }
	button:disabled { opacity: 0.6; cursor: progress; }
	.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
