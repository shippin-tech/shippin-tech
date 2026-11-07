<script lang="ts">
	import { onMount } from 'svelte';
	import Contact from '$lib/catalog/contact/Contact.svelte';
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

<Contact {people} {notice} />
