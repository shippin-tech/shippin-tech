<script lang="ts">
	import { onMount } from 'svelte';
	import Mailbox from '$lib/catalog/mailbox/Mailbox.svelte';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { mailNodes } from '$lib/flow/mail/nodes';
	import { loadFolders, loadMessages, type Folder, type Message } from '$lib/adapter/mail';

	let folders = $state<Folder[]>([]);
	let messages = $state<Message[]>([]);
	let selectedId = $state('');
	let notice = $state('Loading mail from the engine.');

	async function select(id: string) {
		selectedId = id;
		notice = '';
		try {
			messages = await loadMessages(id);
		} catch (err) {
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

<div class="split">
	<Mailbox {folders} {messages} {selectedId} {notice} onselect={select} />
	<section>
		<h2>Mail graph</h2>
		<GraphMount items={mailNodes} />
	</section>
</div>

<style>
	.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr)); gap: var(--x-s); padding-block-end: var(--y-m); }
	h2 { margin: 0 0 var(--space-2); color: var(--color-brand); }
</style>
