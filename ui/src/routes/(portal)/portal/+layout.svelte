<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Portal from '$lib/catalog/portal/Portal.svelte';
	import BootstrapWizard from '$lib/catalog/portal/BootstrapWizard.svelte';
	import { completeBootstrap, loadBootstrap } from '$lib/adapter/bootstrap';
	import { account } from '$lib/adapter/session';
	import { valuesFromRecord, wizardFromGet } from '$lib/portal/bootstrap';
	import { bootstrap } from '$lib/portal/catalog';
	import { bindScriptedSignals } from '$lib/adapter/signal';

	let { children } = $props();
	const active = $derived(page.params.view ?? '');
	let wizard = $state(false);
	let values = $state<Record<string, string | boolean>>({});
	let ready = $state(false);
	let loadError = $state('');

	onMount(() => {
		const unbindSignals = bindScriptedSignals();
		if (!account()) {
			ready = true;
			return () => {
				unbindSignals();
			};
		}
		loadBootstrap()
			.then((list) => {
				ready = true;
				if (wizardFromGet(list) !== 'wizard') return;
				const record = list[0];
				if (!record) return;
				values = valuesFromRecord(bootstrap.steps, record);
				wizard = true;
			})
			.catch((error) => {
				ready = true;
				loadError = error instanceof Error ? error.message : 'Failed to load setup state.';
				wizard = false;
			});
		return () => {
			unbindSignals();
		};
	});

	function onchange(name: string, value: string | boolean) {
		values = { ...values, [name]: value };
	}

	function onfinish() {
		return completeBootstrap(bootstrap.steps, values);
	}
</script>

{#if wizard}
	<BootstrapWizard {values} {onchange} {onfinish} {ready} {loadError} />
{:else}
	<Portal {active}>
		{@render children()}
	</Portal>
{/if}
