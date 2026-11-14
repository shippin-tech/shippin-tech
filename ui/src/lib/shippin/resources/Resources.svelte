<script lang="ts">
	import UsageMeter from './UsageMeter.svelte';
	import { bytesText, diskUsed, levelOf, percentOf, sortByAttention, type ResourceReport } from './resources-call';

	let { report, notice }: { report: ResourceReport | null; notice: string } = $props();

	const orgs = $derived(report ? sortByAttention(report.orgs) : []);
</script>

<section class="resources" aria-labelledby="resources-title">
	<header>
		<h1 id="resources-title">Resources</h1>
		<p class="muted">How the server is doing, and how much each organisation is using.</p>
	</header>

	{#if notice}<p role="status">{notice}</p>{/if}

	{#if report}
		<section aria-labelledby="server-title">
			<h2 id="server-title">This server</h2>
			<p class="muted">{report.server.host}</p>
			<div class="grid">
				{#if report.server.disk}
					{@const used = diskUsed(report.server.disk)}
					<UsageMeter
						label="Disk"
						detail="{bytesText(used)} of {bytesText(report.server.disk.total)}"
						percent={percentOf(used, report.server.disk.total)}
						level={levelOf(used, report.server.disk.total)}
					/>
				{/if}
				<dl>
					<div><dt>Memory in use</dt><dd>{bytesText(report.server.memory)}</dd></div>
					<div><dt>People</dt><dd>{report.server.people}</dd></div>
					<div><dt>Domains</dt><dd>{report.server.domains}</dd></div>
					<div><dt>Mail waiting to send</dt><dd>{report.server.queue}</dd></div>
				</dl>
			</div>
		</section>

		<section aria-labelledby="orgs-title">
			<h2 id="orgs-title">Organisations</h2>
			{#if orgs.length === 0}
				<p class="muted">No organisations yet.</p>
			{:else}
				<ul aria-label="Organisation usage">
					{#each orgs as org (org.id)}
						<li>
							<h3>{org.name}</h3>
							<p class="muted">{org.domains.join(', ')}</p>
							<UsageMeter label="People" detail="{org.people} of {org.maxPeople}" percent={percentOf(org.people, org.maxPeople)} level={org.peopleLevel} />
							<UsageMeter
								label="Storage used"
								detail={org.maxStorage > 0 ? `${bytesText(org.storageUsed)} of ${bytesText(org.maxStorage)}` : `${bytesText(org.storageUsed)}, no overall limit`}
								percent={percentOf(org.storageUsed, org.maxStorage)}
								level={org.storageLevel}
							/>
							<p class="muted">{bytesText(org.storageHeld)} set aside for its people.</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section aria-labelledby="other-title">
			<h2 id="other-title">Not in an organisation</h2>
			<p>{report.other.domains} {report.other.domains === 1 ? 'domain' : 'domains'}, {report.other.people} {report.other.people === 1 ? 'person' : 'people'}, {bytesText(report.other.storageUsed)} used.</p>
		</section>
	{/if}
</section>

<style>
	.resources, section { display: grid; gap: var(--y-2xs); min-width: 0; }
	.resources { gap: var(--y-s); }
	h1, h2, h3, p, ul, dl, dd { margin: 0; }
	h2 { font-size: 1.125rem; }
	h3 { font-size: 1rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; display: grid; gap: var(--y-2xs); }
	li, .grid { display: grid; gap: var(--y-2xs); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--x-2xs); }
	dt { color: var(--color-muted); font-size: 0.875rem; }
	dd { font-size: 1.25rem; font-weight: 600; }
	.muted { color: var(--color-muted); overflow-wrap: anywhere; }
</style>
