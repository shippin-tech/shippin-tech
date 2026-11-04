<script lang="ts">
	import Domain from '$lib/catalog/domain/Domain.svelte';
	import type { DomainVariant } from '$lib/catalog/domain/variants';
	import { registryGet, type RegistryRow } from '$lib/adapter/registry';
	import { session } from '../../session.svelte';
	let variant = $state<DomainVariant>('idle');
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
			rows = await registryGet('Domain', session.username, session.password);
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

<Domain {variant} {rows} {alert} {pending} {onload} />
