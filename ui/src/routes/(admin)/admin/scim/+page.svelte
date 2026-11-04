<script lang="ts">
	import Scim from '$lib/catalog/scim/Scim.svelte';
	import type { ScimVariant } from '$lib/catalog/scim/variants';
	import { scimProvider } from '$lib/adapter/registry';
	import { session } from '../../session.svelte';
	let variant = $state<ScimVariant>('idle');
	let body = $state('');
	let alert = $state('');
	let pending = $state(false);

	async function onload() {
		if (!session.username || !session.password) {
			variant = 'error';
			alert = 'Enter the engine user and secret first.';
			return;
		}
		pending = true;
		alert = '';
		try {
			body = await scimProvider(session.username, session.password);
			variant = 'loaded';
		} catch (error) {
			variant = 'error';
			body = '';
			alert = error instanceof Error ? error.message : 'The engine did not answer.';
		} finally {
			pending = false;
		}
	}
</script>

<Scim {variant} {body} {alert} {pending} {onload} />
