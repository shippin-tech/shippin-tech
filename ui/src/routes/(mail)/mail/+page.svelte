<script lang="ts">
	import { onMount } from 'svelte';
	import Mailbox from '$lib/catalog/mailbox/Mailbox.svelte';
	import { loadFolders, loadMessages, type Folder, type Message } from '$lib/adapter/mail';
	import { page } from '$app/state';

	const sent = page.url.searchParams.get('sent') === '1';

	let folders = $state<Folder[]>([]);
	let messages = $state<Message[]>([]);
	let selectedId = $state('');
	let notice = $state('Loading mail from the engine.');
	let request = 0;

	async function select(id: string) {
		const current = ++request;
		selectedId = id;
		messages = [];
		notice = 'Loading messages.';
		try {
			const loaded = await loadMessages(id);
			if (current !== request) return;
			messages = loaded;
			notice = '';
		} catch (err) {
			if (current !== request) return;
			messages = [];
			notice = err instanceof Error ? err.message : 'Mail could not be loaded.';
		}
	}

	onMount(async () => {
		try {
			folders = await loadFolders();
			const inbox = folders.find((folder) => folder.role === 'inbox') ?? folders[0];
			if (!inbox) {
				notice = 'No mailboxes yet.';
				return;
			}
			await select(inbox.id);
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Mail could not be loaded.';
		}
	});

</script>

<section class="workspace">
	{#if sent}<p class="sent" role="status">Message sent.</p>{/if}
	<Mailbox {folders} {messages} {selectedId} {notice} onselect={select} />
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
	.sent { margin: 0; padding: var(--space-2) var(--space-3); border-inline-start: 3px solid var(--green, #16a34a); background: var(--color-card); }
</style>
