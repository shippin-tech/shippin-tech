<script lang="ts">
	import BootstrapWizard from '$lib/catalog/portal/BootstrapWizard.svelte';
	import { emptyValues } from '$lib/portal/bootstrap';
	import { bootstrap } from '$lib/portal/catalog';

	let values = $state(emptyValues(bootstrap.steps));

	function onchange(name: string, value: string | boolean) {
		values = { ...values, [name]: value };
	}

	function onfinish() {
		return Promise.resolve({ status: 'missing' as const, credentials: [] });
	}
</script>

<BootstrapWizard {values} {onchange} {onfinish} />
