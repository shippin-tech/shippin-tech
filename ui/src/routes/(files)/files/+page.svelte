<script lang="ts">
	import { onMount } from 'svelte';
	import File from '$lib/catalog/file/File.svelte';
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';
	import { loadFiles, type Named } from '$lib/adapter/groupware';

	let files = $state<Named[]>([]);
	let notice = $state('Loading files.');

	onMount(async () => {
		try {
			files = await loadFiles();
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Files could not be loaded.';
		}
	});

</script>

<section class="workspace">
	<WorkspaceDeployPanel blueprint="drive" resource="workspace-drive" title="Queue drive deployment" />
	<File title="Drive" {files} {notice} />
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
