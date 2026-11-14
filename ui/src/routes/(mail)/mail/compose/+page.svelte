<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Compose from '$lib/catalog/email/Compose.svelte';
	import { loadOriginal, saveDraft, sendDraft, uploadAttachment } from '$lib/adapter/send';
	import { account } from '$lib/adapter/session';
	import { emptyDraft, forwardDraft, formatAddresses, replyDraft, type Draft } from '$lib/mail/compose';
	import { mcplEmit } from '$lib/mcpl/events';

	const send = (next: Draft) => sendDraft(next).then(() => mcplEmit('mail.message.sent', from, { attachments: next.attachments.length }));
	const save = (next: Draft) => saveDraft(next).then((id) => (mcplEmit('mail.draft.saved', from), id));

	let draft = $state<Draft | null>(null);
	let title = $state('New message');
	let problem = $state('');
	const from = account()?.username ?? '';

	onMount(async () => {
		const params = page.url.searchParams;
		const reply = params.get('reply');
		const forward = params.get('forward');
		const existing = params.get('draft');
		try {
			const id = reply ?? forward ?? existing;
			if (!id) {
				draft = { ...emptyDraft(), to: params.get('to') ?? '' };
				return;
			}
			const original = await loadOriginal(id);
			if (!original) {
				problem = 'That message is not in this mailbox.';
				return;
			}
			if (reply) {
				const all = params.get('all') === '1';
				draft = replyDraft(original, from, all);
				title = all ? 'Reply all' : 'Reply';
			} else if (forward) {
				draft = forwardDraft(original);
				title = 'Forward';
			} else {
				draft = {
					...emptyDraft(),
					to: formatAddresses(original.to),
					cc: formatAddresses(original.cc),
					subject: original.subject,
					body: original.body ?? '',
					attachments: original.attachments,
					draftId: original.id
				};
				title = 'Draft';
			}
		} catch (err) {
			problem = err instanceof Error ? err.message : 'The message could not be loaded.';
		}
	});

	function done(outcome: 'sent' | 'saved' | 'discarded') {
		void goto(outcome === 'sent' ? '/mail?sent=1' : '/mail');
	}
</script>

<svelte:head><title>{title}</title></svelte:head>

{#if problem}
	<p class="note" role="alert">{problem} <a href="/mail">Back to mail</a></p>
{:else if draft}
	<Compose {draft} {from} {title} onsend={send} onsave={save} onupload={uploadAttachment} ondone={done} />
{:else}
	<p class="note">Loading…</p>
{/if}

<style>
	.note { max-inline-size: 40rem; margin-inline: auto; padding: var(--space-3); }
</style>
