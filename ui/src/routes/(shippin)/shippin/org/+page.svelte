<script lang="ts">
	import { onMount } from 'svelte';
	import OrgOverview from '$lib/shippin/org/OrgOverview.svelte';
	import { loadMyOrg, type MyOrg } from '$lib/shippin/org/orgs';

	let org = $state<MyOrg | null>(null);
	let notice = $state('Loading your organisation.');

	onMount(async () => {
		try {
			org = await loadMyOrg();
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Your organisation could not be loaded.';
		}
	});
</script>

<svelte:head><title>Your organisation</title></svelte:head>

<OrgOverview {org} {notice} />
