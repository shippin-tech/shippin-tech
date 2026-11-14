<script lang="ts">
	import PortingBoard from './PortingBoard.svelte';
	import {
		dispositionCounts,
		ledgerDispositions,
		ledgerGroups,
		platformLedger,
		type PlatformLedgerEntry
	} from '$lib/platform/ledger';

	const entries = platformLedger();
	const groupOptions = ledgerGroups(entries);
	const dispositionOptions = ledgerDispositions(entries);
	const counts = dispositionCounts(entries);

	let group = $state('');
	let disposition = $state('');
	let query = $state('');

	const visible = $derived(filterEntries(entries, group, disposition, query));

	function filterEntries(
		rows: readonly PlatformLedgerEntry[],
		nextGroup: string,
		nextDisposition: string,
		nextQuery: string
	): PlatformLedgerEntry[] {
		const filter = nextQuery.trim().toLowerCase();
		return rows.filter((entry) => {
			if (nextGroup && entry.sourceGroup !== nextGroup) return false;
			if (nextDisposition && entry.disposition !== nextDisposition) return false;
			if (!filter) return true;
			return `${entry.path} ${entry.destination} ${entry.evidence}`.toLowerCase().includes(filter);
		});
	}
</script>

<section class="panel">
	<header>
		<p class="eyebrow">Developer view</p>
		<h1>Porting ledger</h1>
		<p>
			Where each imported platform route and source file stands in the port. Read-only planning data; nothing here deploys anything.
		</p>
	</header>
	<div class="cards">
		{#each Object.entries(counts) as [name, value] (name)}
			<article><h2>{name}</h2><p>{value}</p></article>
		{/each}
	</div>
	<div class="filters">
		<label>
			Source group
			<select value={group} onchange={(event) => (group = event.currentTarget.value)}>
				<option value="">All groups</option>
				{#each groupOptions as option (option)}<option value={option}>{option}</option>{/each}
			</select>
		</label>
		<label>
			Disposition
			<select value={disposition} onchange={(event) => (disposition = event.currentTarget.value)}>
				<option value="">All dispositions</option>
				{#each dispositionOptions as option (option)}<option value={option}>{option}</option>{/each}
			</select>
		</label>
		<label>
			Search path/evidence
			<input type="search" bind:value={query} placeholder="Filter ledger rows" />
		</label>
	</div>
	<div class="table">
		<table>
			<thead>
				<tr>
					<th scope="col">Source path</th>
					<th scope="col">Group</th>
					<th scope="col">Disposition</th>
					<th scope="col">Destination</th>
				</tr>
			</thead>
			<tbody>
				{#if visible.length === 0}
					<tr><td colspan={4}>No matching routes/files.</td></tr>
				{:else}
					{#each visible as entry (entry.path)}
						<tr>
							<td>{entry.path}</td>
							<td>{entry.sourceGroup}</td>
							<td>{entry.disposition}</td>
							<td>{entry.destination}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	<PortingBoard />
</section>

<style>
	.panel { display: grid; gap: var(--space-3); }
	header, .filters { display: grid; gap: var(--space-2); }
	.eyebrow { color: var(--color-brand); font-weight: 700; margin: 0; }
	h1, h2, p { margin: 0; }
	.filters { grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); align-items: end; }
	label { display: grid; gap: var(--space-1); }
	.table { overflow: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; border-bottom: 1px solid var(--color-border); padding: var(--space-2); vertical-align: top; }
</style>
