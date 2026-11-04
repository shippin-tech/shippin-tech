<script lang="ts">
	import File from '$lib/catalog/file/File.svelte';
	import GraphMount from '$lib/flow/GraphMount.svelte';
	import { docsNodes } from '$lib/flow/docs/nodes';
</script>

<div class="split">
	<File />
	<section>
		<h2>Docs graph</h2>
		<GraphMount items={docsNodes} />
	</section>
</div>

<style>
	.split { display: grid; grid-template-columns: 1.3fr 1fr; gap: var(--space-3); padding: 0 var(--space-3) var(--space-4); }
	h2 { margin: 0 0 var(--space-2); color: var(--color-brand); font-size: 1rem; }
	@media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
</style>
