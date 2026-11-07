<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Email from '$lib/catalog/email/Email.svelte';
	import { loadMessage, type MessageDetail } from '$lib/adapter/mail';

	let message = $state<MessageDetail | null>(null);
	let notice = $state('Loading the message.');

	onMount(async () => {
		const id = page.url.searchParams.get('id');
		if (!id) {
			notice = '';
			return;
		}
		try {
			message = await loadMessage(id);
			notice = message ? '' : 'That message is not in this account.';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'The message could not be loaded.';
		}
	});
</script>

<Email {message} {notice} />
