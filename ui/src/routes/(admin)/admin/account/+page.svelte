<script lang="ts">
	import Account from '$lib/catalog/account/Account.svelte';
	import type { AccountVariant } from '$lib/catalog/account/variants';
	import { registryGet, type RegistryRow } from '$lib/adapter/registry';
	import { session } from '../../session.svelte';
	let variant = $state<AccountVariant>('empty');
	let rows = $state<RegistryRow[]>([]);
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
			rows = await registryGet('Account', session.username, session.password);
			variant = rows.length ? 'list' : 'empty';
		} catch (error) {
			variant = 'error';
			rows = [];
			alert = error instanceof Error ? error.message : 'The engine did not answer.';
		} finally {
			pending = false;
		}
	}
</script>

<Account {variant} {rows} {alert} {pending} {onload} />
