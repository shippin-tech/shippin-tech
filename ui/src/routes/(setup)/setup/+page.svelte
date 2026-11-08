<script lang="ts">
	import BootstrapWizard from '$lib/catalog/portal/BootstrapWizard.svelte';
	import { completeBootstrap, loadBootstrap } from '$lib/adapter/bootstrap';
	import { onMount } from 'svelte';
	import { emptyValues, valuesFromRecord } from '$lib/portal/bootstrap';
	import { bootstrap } from '$lib/portal/catalog';
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';

	let values = $state(emptyValues(bootstrap.steps));
	let ready = $state(false);
	let loadError = $state('');

	onMount(() => {
		loadBootstrap()
			.then((list) => {
				ready = true;
				const record = list[0];
				if (!record) return;
				values = valuesFromRecord(bootstrap.steps, record);
			})
			.catch((error) => {
				ready = true;
				loadError = error instanceof Error ? error.message : 'Failed to load setup state.';
			});
	});

	function onchange(name: string, value: string | boolean) {
		values = { ...values, [name]: value };
	}

	function onfinish() {
		return completeBootstrap(bootstrap.steps, values);
	}
</script>

<section class="setup">
	<WorkspaceDeployPanel blueprint="mail" resource="setup-wizard" title="Queue managed mail deployment" />
	<BootstrapWizard {values} {onchange} {onfinish} {ready} {loadError} />
</section>

<style>
	.setup { display: grid; gap: var(--space-3); }
</style>
