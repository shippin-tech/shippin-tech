<script lang="ts">
	import UsageMeter from '$lib/shippin/resources/UsageMeter.svelte';
	import { bytesText, levelOf, percentOf } from '$lib/shippin/resources/resources-call';
	import type { MyOrg } from './orgs-call';

	let { org, notice }: { org: MyOrg | null; notice: string } = $props();
</script>

<section class="overview" aria-labelledby="overview-title">
	<h1 id="overview-title">{org?.name ?? 'Your organisation'}</h1>
	{#if notice}<p role="status">{notice}</p>{/if}

	{#if org}
		<div class="meters">
			<UsageMeter label="People" detail="{org.people.length} of {org.maxPeople}" percent={percentOf(org.people.length, org.maxPeople)} level={levelOf(org.people.length, org.maxPeople)} />
			<UsageMeter
				label="Storage used"
				detail={org.maxStorage > 0 ? `${bytesText(org.storageUsed)} of ${bytesText(org.maxStorage)}` : `${bytesText(org.storageUsed)}, no overall limit`}
				percent={percentOf(org.storageUsed, org.maxStorage)}
				level={levelOf(org.storageUsed, org.maxStorage)}
			/>
		</div>
		<dl>
			<div><dt>Teams</dt><dd>{org.teams.length}</dd></div>
			<div><dt>Domains</dt><dd>{org.domains.length}</dd></div>
		</dl>
		<section aria-labelledby="your-domains">
			<h2 id="your-domains">Your domains</h2>
			<ul>
				{#each org.domains as domain (domain.id)}<li>{domain.name}</li>{/each}
			</ul>
			<p><a href="/shippin/org/domains">Check their DNS, logo and sign-in</a></p>
		</section>
	{/if}
</section>

<style>
	.overview, section { display: grid; gap: var(--y-2xs); min-width: 0; }
	.overview { gap: var(--y-s); }
	h1, h2, p, ul, dl, dd { margin: 0; }
	h1 { overflow-wrap: anywhere; }
	h2 { font-size: 1.125rem; }
	ul { padding-inline-start: 1.25rem; overflow-wrap: anywhere; }
	.meters { display: grid; gap: var(--y-2xs); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	dl { display: flex; flex-wrap: wrap; gap: var(--x-s); }
	dt { color: var(--color-muted); font-size: 0.875rem; }
	dd { font-size: 1.25rem; font-weight: 600; }
</style>
