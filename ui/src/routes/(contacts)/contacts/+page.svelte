<script lang="ts">
	import { onMount } from 'svelte';
	import Contact from '$lib/catalog/contact/Contact.svelte';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { mailNodes } from '$lib/flow/mail/nodes';
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

<div class="split">
	<Contact {people} {notice} />
	<section>
		<h2>Mail graph</h2>
		<GraphMount items={mailNodes} />
	</section>
</div>

<style>
	.split { display: grid; grid-template-columns: 1.3fr 1fr; gap: var(--space-3); padding: 0 var(--space-3) var(--space-4); }
	h2 { margin: 0 0 var(--space-2); color: var(--color-brand); font-size: 1rem; }
	@media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
</style>
