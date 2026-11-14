<script lang="ts">
	import { onMount } from 'svelte';
	import SignupFlow from '$lib/catalog/panel/SignupFlow.svelte';
	import { completeSignup, loadPlan, requestVerifyRecord } from '$lib/adapter/panel';
	import type { PanelPlan } from '$lib/panel/model';
	import { mcplEmit } from '$lib/mcpl/events';

	const complete = (domain: string, name: string, password: string) =>
		completeSignup(domain, name, password).then((result) => (mcplEmit('panel.domain.created', result.domain), result));

	let plan = $state<PanelPlan | null>(null);
	let planError = $state('');

	onMount(() => {
		loadPlan()
			.then((next) => (plan = next))
			.catch((err) => (planError = err instanceof Error ? err.message : 'This server does not offer signups.'));
	});
</script>

<svelte:head><title>Create a free account</title></svelte:head>

<SignupFlow {plan} {planError} onrequest={requestVerifyRecord} oncomplete={complete} />
