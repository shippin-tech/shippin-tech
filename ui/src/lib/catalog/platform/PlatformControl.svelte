<script lang="ts">
	import { createSignal } from '$lib/portal/signal';
	import { portalSignals, publishSignals } from '$lib/adapter/signal';
	import { onDestroy } from 'svelte';
	import DeploymentPlanner from './DeploymentPlanner.svelte';
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

	const serviceBlueprints = [
		{ id: 'mail', title: 'Managed Mail Core', description: 'Multi-tenant mail hosting with tenant-bound installation targets and lifecycle controls.' },
		{ id: 'drive', title: 'Drive Workspace', description: 'File lifecycle, quotas, and sharing boundaries for hosted workspace storage.' },
		{ id: 'docs', title: 'Docs Collaboration', description: 'Document editing/collaboration contracts over tenant-authorized services.' },
		{ id: 'cloudflare', title: 'DNS Cloudflare Integration', description: 'Managed DNS binding, verification, and change audit for domain onboarding.' },
		{ id: 'google-drive', title: 'Google Drive Connector', description: 'External provider sync/control for bring-your-own content and migration workflows.' }
	] as const;

	let group = $state('');
	let disposition = $state('');
	let query = $state('');
	let signals = $state<ReturnType<typeof createSignal>[]>([]);
	let selectedBlueprint = $state<(typeof serviceBlueprints)[number] | null>(serviceBlueprints[0]);

	const visible = $derived(filterEntries(entries, group, disposition, query));

	const unsubscribe = portalSignals.subscribe((next) => {
		signals = next.slice(-30);
	});
	onDestroy(() => unsubscribe());

	function emitBlueprint(id: string) {
		publishSignals([
			createSignal({
				channel: 'scripted',
				source: 'scripted-ai',
				eventType: `deploy.blueprint.${id}`,
				resource: 'platform-control',
				status: 'pending',
				severity: 'info',
				payload: { blueprint: id }
			})
		]);
	}

	function chooseBlueprint(id: string) {
		selectedBlueprint = serviceBlueprints.find((item) => item.id === id) ?? null;
		emitBlueprint(id);
	}

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
		<p class="eyebrow">Platform absorption</p>
		<h1>Service control ledger</h1>
		<p>
			Route and source disposition ledger for C1/C4 porting, with deployable service blueprints for Shippin-managed hosting.
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
	<section class="blueprints">
		<h2>Deployable service blueprints</h2>
		<div class="cards">
			{#each serviceBlueprints as item (item.id)}
				<article>
					<h3>{item.title}</h3>
					<p>{item.description}</p>
					<button type="button" onclick={() => chooseBlueprint(item.id)}>Select and emit AI trigger</button>
				</article>
			{/each}
		</div>
	</section>
	{#if selectedBlueprint}
		<DeploymentPlanner blueprint={selectedBlueprint.id} blueprintLabel={selectedBlueprint.title} />
	{/if}
	<section class="signals">
		<h2>AI trigger signal feed</h2>
		{#if signals.length === 0}
			<p>No emitted signals yet.</p>
		{:else}
			<ol>
				{#each signals.slice().reverse() as signal (signal.id)}
					<li>
						<strong>{signal.eventType}</strong>
						<p>{signal.timestamp} · {signal.channel} · {signal.status}</p>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</section>

<style>
	.panel { display: grid; gap: var(--space-3); }
	header, .filters { display: grid; gap: var(--space-2); }
	.eyebrow { color: var(--color-brand); font-weight: 700; margin: 0; }
	h1, h2, h3, p { margin: 0; }
	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: var(--space-2); }
	.cards article { border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); padding: var(--space-3); display: grid; gap: var(--space-2); }
	.filters { grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); align-items: end; }
	label { display: grid; gap: var(--space-1); }
	.table { overflow: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; border-bottom: 1px solid var(--color-border); padding: var(--space-2); vertical-align: top; }
	button { width: fit-content; background: var(--color-card); border: 1px solid var(--color-border); color: var(--color-text); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
	.signals ol { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: var(--space-1); }
	.signals li p { color: var(--color-muted); }
</style>
