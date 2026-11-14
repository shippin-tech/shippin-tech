<script lang="ts">
	import type { Snippet } from 'svelte';
	import { checkFor, parseZone, stateLabel } from '$lib/panel/model';
	import type { MyOrg, OrgDns, OrgDomain } from './orgs-call';

	let {
		org,
		dns,
		notice,
		oncheck,
		settings
	}: {
		org: MyOrg | null;
		dns: Record<string, OrgDns | undefined>;
		notice: string;
		oncheck: (domain: OrgDomain) => void;
		settings: Snippet<[OrgDomain]>;
	} = $props();
</script>

<section class="domains" aria-labelledby="domains-title">
	<h1 id="domains-title">Domains</h1>
	{#if notice}<p role="status">{notice}</p>{/if}

	{#each org?.domains ?? [] as domain (domain.id)}
		{@const report = dns[domain.id]}
		{@const rows = report ? parseZone(report.zone, report.domain).filter((row) => row.required) : []}
		<article aria-labelledby="domain-{domain.id}">
			<h2 id="domain-{domain.id}">{domain.name}</h2>
			<div class="line">
				<p>
					{#if report}
						{report.records.filter((record) => record.state === 'found').length} of {report.records.length} DNS records are published.
					{:else}
						Checking DNS.
					{/if}
				</p>
				<button type="button" onclick={() => oncheck(domain)}>Check again<span class="sr"> {domain.name}</span></button>
			</div>
			{#if report}
				<div class="scroll">
					<table>
						<thead><tr><th scope="col">Status</th><th scope="col">Type</th><th scope="col">Host</th><th scope="col">Value</th></tr></thead>
						<tbody>
							{#each rows as row, index (index)}
								{@const check = checkFor(row, report.records)}
								<tr>
									<td>{stateLabel(check)}</td>
									<td><code>{row.type}</code></td>
									<td><code>{row.host}</code></td>
									<td class="value"><code>{row.value}</code></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{@render settings(domain)}
		</article>
	{/each}
</section>

<style>
	.domains { display: grid; gap: var(--y-s); min-width: 0; }
	h1, h2, p { margin: 0; }
	h2 { font-size: 1.125rem; overflow-wrap: anywhere; }
	article { display: grid; gap: var(--y-2xs); min-width: 0; padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.line { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--x-2xs); }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	.scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border); text-align: start; vertical-align: top; }
	thead th { color: var(--color-muted); font-size: 0.875rem; }
	.value { overflow-wrap: anywhere; min-width: 12rem; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
