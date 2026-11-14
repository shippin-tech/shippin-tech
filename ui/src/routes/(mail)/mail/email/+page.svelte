<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Email from '$lib/catalog/email/Email.svelte';
	import { downloadAttachment, loadOriginal } from '$lib/adapter/send';
	import { formatAddresses } from '$lib/mail/compose';

	type Shown = {
		id: string;
		subject: string;
		from: string;
		to: string;
		receivedAt: string;
		body: string | null;
		truncated: boolean;
		attachments: { blobId: string; name: string; type: string; size: number }[];
		draft: boolean;
	};

	let message = $state<Shown | null>(null);
	let notice = $state('Loading the message.');

	onMount(async () => {
		const id = page.url.searchParams.get('id');
		if (!id) {
			notice = '';
			return;
		}
		try {
			const found = await loadOriginal(id);
			if (!found) {
				notice = 'That message is not in this account.';
				return;
			}
			message = {
				id: found.id,
				subject: found.subject || '(no subject)',
				from: formatAddresses(found.from),
				to: formatAddresses([...found.to, ...found.cc]),
				receivedAt: found.receivedAt,
				body: found.body,
				truncated: found.truncated,
				attachments: found.attachments,
				draft: found.draft
			};
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'The message could not be loaded.';
		}
	});
</script>

<Email {message} {notice} ondownload={downloadAttachment} />
