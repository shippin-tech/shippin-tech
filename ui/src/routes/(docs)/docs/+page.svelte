<script lang="ts">
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';
</script>

<section class="docs">
	<p class="eyebrow">Workspace</p>
	<h1>Docs</h1>
	<p>
		Document hosting and collaboration are deployed through the Platform planner. Use Drive now, then queue a Docs blueprint for managed or self-host rollout.
	</p>
	<div class="actions"><a href="/files">Open Drive <span aria-hidden="true">→</span></a></div>
	<WorkspaceDeployPanel blueprint="docs" resource="docs-workspace" title="Queue docs deployment" />
</section>

<style>
	.docs {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	h1, p { margin: 0; }
	.eyebrow { color: var(--color-brand); font-weight: 650; }
	p { color: var(--color-muted); }
	a { width: fit-content; font-weight: 650; }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
</style>
