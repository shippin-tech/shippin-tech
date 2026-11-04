<script lang="ts">
	type FileRow = { id: string; name: string };
	type Props = { title: string; files: FileRow[]; notice: string };
	let { title, files, notice }: Props = $props();
</script>

<section class="files">
	<h1>{title}</h1>
	{#if notice}
		<p>{notice}</p>
	{:else if files.length === 0}
		<p>No files yet.</p>
	{:else}
		<ul>
			{#each files as file (file.id)}
				<li>{file.name}</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.files {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-2);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	h1, p { margin: 0; }
	h1 { color: var(--color-brand); }
	ul { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-2); }
	li { padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); }
	p { color: var(--color-muted); }
</style>
