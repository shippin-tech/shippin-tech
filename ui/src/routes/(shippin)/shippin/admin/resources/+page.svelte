<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Resources from '$lib/shippin/resources/Resources.svelte';
	import { loadResources, type ResourceReport } from '$lib/shippin/resources/resources';

	const REFRESH_MS = 60_000;

	let report = $state<ResourceReport | null>(null);
	let notice = $state('Loading.');
	let timer: ReturnType<typeof setInterval> | undefined;

	async function load() {
		try {
			report = await loadResources();
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Resources could not be loaded.';
		}
	}

	onMount(() => {
		void load();
		timer = setInterval(load, REFRESH_MS);
	});
	onDestroy(() => clearInterval(timer));
</script>

<svelte:head><title>Resources</title></svelte:head>

<Resources {report} {notice} />
