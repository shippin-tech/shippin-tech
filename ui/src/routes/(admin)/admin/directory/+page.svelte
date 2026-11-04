<script lang="ts">
	import Directory from '$lib/catalog/directory/Directory.svelte';
	import type { DirectoryVariant } from '$lib/catalog/directory/variants';
	import { freeDiskQuota, registryGet, type RegistryRow } from '$lib/adapter/registry';
	import { session } from '../../session.svelte';
	let variant = $state<DirectoryVariant>('empty');
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
			rows = await registryGet('Tenant', session.username, session.password);
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

<Directory {variant} {rows} preset={freeDiskQuota} {alert} {pending} {onload} />
