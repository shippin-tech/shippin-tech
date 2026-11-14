<script lang="ts">
	import {
		inventoryStatusCounts,
		packageBacklog,
		portingQueue,
		webuiInventory,
		type InventoryFile
	} from '$lib/porting/inventory';

	const queue = portingQueue();
	const inventory = webuiInventory();
	const statusCounts = inventoryStatusCounts(inventory.files);
	const backlog = packageBacklog(inventory.files);
	const packageMap = new Map(queue.packages.map((entry) => [entry.id, entry]));
	const packageOptions = queue.packages.map((entry) => entry.id);

	let status = $state('');
	let packageId = $state('');
	let query = $state('');
	let remainingOnly = $state(true);

	const visible = $derived(filterFiles(inventory.files, status, packageId, query, remainingOnly));

	function filterFiles(
		files: readonly InventoryFile[],
		nextStatus: string,
		nextPackage: string,
		nextQuery: string,
		nextRemainingOnly: boolean
	): InventoryFile[] {
		const needle = nextQuery.trim().toLowerCase();
		return files.filter((file) => {
			if (nextStatus && file.status !== nextStatus) return false;
			if (nextPackage && !file.work_packages.includes(nextPackage)) return false;
			if (nextRemainingOnly && !hasRemainingWork(file.status, file.remaining)) return false;
			if (!needle) return true;
			return `${file.source} ${file.remaining} ${file.owners.join(' ')}`.toLowerCase().includes(needle);
		});
	}

	function hasRemainingWork(statusValue: string, remaining: string): boolean {
		if (statusValue === 'implemented-representative-proof') return true;
		if (statusValue === 'partial' || statusValue === 'planned' || statusValue === 'unimplemented') return true;
		return remaining.trim().length > 0 && !remaining.toLowerCase().includes('tracked separately');
	}
</script>

<section class="porting">
	<header>
		<p class="eyebrow">WebUI absorption</p>
		<h2>Svelte absorption board</h2>
		<p>{queue.focus}</p>
	</header>
	<div class="cards">
		{#each Object.entries(statusCounts) as [key, count] (key)}
			<article><h3>{key}</h3><p>{count}</p></article>
		{/each}
	</div>
	<div class="filters">
		<label>
			Status
			<select bind:value={status}>
				<option value="">All statuses</option>
				{#each Object.keys(statusCounts).sort((left, right) => left.localeCompare(right)) as item (item)}
					<option value={item}>{item}</option>
				{/each}
			</select>
		</label>
		<label>
			Work package
			<select bind:value={packageId}>
				<option value="">All packages</option>
				{#each packageOptions as item (item)}
					<option value={item}>{item} ({backlog[item] ?? 0} remaining)</option>
				{/each}
			</select>
		</label>
		<label>
			Search source/owner/work
			<input type="search" bind:value={query} placeholder="Filter remaining files" />
		</label>
		<label class="toggle">
			<input type="checkbox" bind:checked={remainingOnly} />
			Only rows with remaining work
		</label>
	</div>
	<div class="table">
		<table>
			<thead>
				<tr>
					<th scope="col">Source file</th>
					<th scope="col">Status</th>
					<th scope="col">Packages</th>
					<th scope="col">Remaining work</th>
				</tr>
			</thead>
			<tbody>
				{#if visible.length === 0}
					<tr><td colspan={4}>No rows match your current filters.</td></tr>
				{:else}
					{#each visible as file (file.source)}
						<tr>
							<td><code>{file.source}</code></td>
							<td>{file.status}</td>
							<td>
								{#each file.work_packages as id (id)}
									<div>
										<strong>{id}</strong>
										{#if packageMap.get(id)}<span> — {packageMap.get(id)?.title}</span>{/if}
									</div>
								{/each}
							</td>
							<td>{file.remaining}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</section>

<style>
	.porting { display: grid; gap: var(--space-3); }
	header { display: grid; gap: var(--space-1); }
	.eyebrow { margin: 0; color: var(--color-brand); font-weight: 700; }
	h2, h3, p { margin: 0; }
	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); gap: var(--space-2); }
	.cards article { border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); padding: var(--space-2); display: grid; gap: var(--space-1); }
	.filters { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); align-items: end; }
	label { display: grid; gap: var(--space-1); }
	.toggle { display: flex; align-items: center; gap: var(--space-2); }
	.table { overflow: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; border-bottom: 1px solid var(--color-border); padding: var(--space-2); vertical-align: top; }
	code { font-family: var(--font-mono); }
</style>
