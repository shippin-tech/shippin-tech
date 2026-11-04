<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Email from '$lib/catalog/email/Email.svelte';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { mailNodes } from '$lib/flow/mail/nodes';
	import { loadMessage, type Message } from '$lib/adapter/mail';

	let message = $state<Message | null>(null);
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

<div class="split">
	<Email {message} {notice} />
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
