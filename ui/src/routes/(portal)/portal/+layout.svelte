<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Portal from '$lib/catalog/portal/Portal.svelte';
	import BootstrapWizard from '$lib/catalog/portal/BootstrapWizard.svelte';
	import { loadBootstrap } from '$lib/adapter/bootstrap';
	import { account } from '$lib/adapter/session';
	import { valuesFromRecord, wizardFromGet } from '$lib/portal/bootstrap';
	import { bootstrap } from '$lib/portal/catalog';

	let { children } = $props();
	const active = $derived(page.params.view ?? '');
	let wizard = $state(false);
	let values = $state<Record<string, string | boolean>>({});

	onMount(() => {
		if (!account()) return;
		loadBootstrap()
			.then((list) => {
				if (wizardFromGet(list) !== 'wizard') return;
				const record = list[0];
				if (!record) return;
				values = valuesFromRecord(bootstrap.steps, record);
				wizard = true;
			})
			.catch(() => {
				wizard = false;
			});
	});

	function onchange(name: string, value: string | boolean) {
		values = { ...values, [name]: value };
	}

	function onfinish() {
		return Promise.resolve({ status: 'missing' as const, credentials: [] });
	}
</script>

{#if wizard}
	<BootstrapWizard {values} {onchange} {onfinish} />
{:else}
	<Portal {active}>
		{@render children()}
	</Portal>
{/if}
