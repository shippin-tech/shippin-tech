<script lang="ts">
	import { onMount } from 'svelte';
	import Contact from '$lib/catalog/contact/Contact.svelte';
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';
	import { loadContacts, type Named } from '$lib/adapter/groupware';

	let people = $state<Named[]>([]);
	let notice = $state('Loading contacts.');

	onMount(async () => {
		try {
			people = await loadContacts();
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Contacts could not be loaded.';
		}
	});

</script>

<section class="workspace">
	<WorkspaceDeployPanel blueprint="mail" resource="workspace-contacts" title="Queue contacts deployment" />
	<Contact {people} {notice} />
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
