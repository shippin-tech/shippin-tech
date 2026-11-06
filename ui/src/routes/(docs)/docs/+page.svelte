<script lang="ts">
	import { onMount } from 'svelte';
	import File from '$lib/catalog/file/File.svelte';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { docsNodes } from '$lib/flow/docs/nodes';
	import { loadFiles, type Named } from '$lib/adapter/groupware';

	let files = $state<Named[]>([]);
	let notice = $state('Loading documents.');

	onMount(async () => {
		try {
			files = await loadFiles();
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Documents could not be loaded.';
		}
	});
</script>

<div class="split">
	<File title="Docs" {files} {notice} />
	<section>
		<h2>Docs graph</h2>
		<GraphMount items={docsNodes} />
	</section>
</div>

<style>
	.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr)); gap: var(--x-s); padding-block-end: var(--y-m); }
	h2 { margin: 0 0 var(--space-2); color: var(--color-brand); }
</style>
