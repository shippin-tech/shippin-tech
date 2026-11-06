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
	.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr)); gap: var(--x-s); padding-block-end: var(--y-m); }
	h2 { margin: 0 0 var(--space-2); color: var(--color-brand); }
</style>
