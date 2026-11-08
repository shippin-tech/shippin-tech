<script lang="ts">
	import { onMount } from 'svelte';
	import Mailbox from '$lib/catalog/mailbox/Mailbox.svelte';
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';
	import { loadFolders, loadMessages, type Folder, type Message } from '$lib/adapter/mail';

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
	<WorkspaceDeployPanel blueprint="mail" resource="workspace-mail" title="Queue mail deployment" />
	<Mailbox {folders} {messages} {selectedId} {notice} onselect={select} />
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
