<script lang="ts">
	type Column = { name: string; label: string };

	let {
		columns,
		rows = [],
		phase = 'pending',
		selected = null,
		onselect
	}: {
		columns: readonly Column[];
		rows?: Record<string, string>[];
		phase?: 'pending' | 'signed-out' | 'ready' | 'error';
		selected?: number | null;
		onselect?: (index: number) => void;
	} = $props();
</script>

<div class="table">
	<table aria-busy={phase === 'pending'}>
		<thead>
			<tr>
				{#each columns as column (column.name)}
					<th scope="col">{column.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if phase === 'signed-out'}
				<tr>
					<td colspan={columns.length}><a href="/login">Sign in</a></td>
				</tr>
			{:else if phase === 'ready' && rows.length === 0}
				<tr>
					<td colspan={columns.length}>No results found</td>
				</tr>
			{:else}
				{#each rows as row, index (row.id || index)}
					<tr>
						{#each columns as column, colIndex (column.name)}
							<td>
								{#if colIndex === 0}
									<button type="button" aria-pressed={selected === index} onclick={() => onselect?.(index)}>
										{row[column.name] || column.label}
									</button>
								{:else}
									{row[column.name]}
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.table { overflow: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td {
		text-align: start;
		padding: var(--y-2xs) var(--x-2xs);
		border-bottom: 1px solid var(--color-border);
	}
	button {
		font: inherit;
		color: var(--color-text);
		background: transparent;
		border: 0;
		padding: 0;
		min-height: 2.75rem;
		text-align: start;
	}
	button[aria-pressed='true'] { color: var(--brand-text); }
</style>
