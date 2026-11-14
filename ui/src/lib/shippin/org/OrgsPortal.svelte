<script lang="ts">
	import type { Snippet } from 'svelte';
	import LogoEditor from './LogoEditor.svelte';
	import { draftFromOrg, emptyOrgDraft, orgProblem, peopleUse, storageUse, type OrgDomain, type OrgDraft, type Organisation } from '$lib/shippin/org/orgs-call';

	let {
		orgs,
		domains,
		notice,
		problem,
		onsave,
		onremove,
		onlogo,
		onlogoremove,
		sso
	}: {
		orgs: Organisation[];
		domains: OrgDomain[];
		notice: string;
		problem: string;
		onsave: (draft: OrgDraft) => Promise<boolean>;
		onremove: (org: Organisation) => void;
		onlogo: (domain: string, file: File) => Promise<void>;
		onlogoremove: (domain: string) => Promise<void>;
		sso?: Snippet<[string]>;
	} = $props();

	let draft = $state<OrgDraft | null>(null);
	let draftProblem = $state('');
	let saving = $state(false);
	let confirming = $state('');

	function domainName(id: string): string {
		return domains.find((domain) => domain.id === id)?.name ?? id;
	}

	function start(next: OrgDraft) {
		draft = next;
		draftProblem = '';
		confirming = '';
	}

	function toggleDomain(id: string, on: boolean) {
		if (!draft) return;
		draft.domains = on ? [...draft.domains, id] : draft.domains.filter((item) => item !== id);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!draft) return;
		draftProblem = orgProblem(draft);
		if (draftProblem) return;
		saving = true;
		const saved = await onsave(draft);
		saving = false;
		if (saved) draft = null;
	}
</script>

<section class="orgs" aria-labelledby="orgs-title">
	<header>
		<h1 id="orgs-title">Organisations</h1>
		<p class="muted">Group domains under their own administrators and limits. An organisation's administrators manage only its people.</p>
	</header>

	<div><button type="button" class="primary" onclick={() => start(emptyOrgDraft())}>New organisation</button></div>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	{#if draft}
		<form class="form" onsubmit={submit} aria-label={draft.id ? 'Edit organisation' : 'New organisation'} novalidate>
			<label><span>Name</span><input bind:value={draft.name} maxlength="120" autocomplete="off" /></label>
			<fieldset>
				<legend>Domains</legend>
				{#each domains as domain (domain.id)}
					<label class="check">
						<input type="checkbox" checked={draft.domains.includes(domain.id)} onchange={(event) => toggleDomain(domain.id, event.currentTarget.checked)} />
						{domain.name}
					</label>
				{/each}
			</fieldset>
			<label>
				<span>Administrators</span>
				<input bind:value={draft.admins} autocomplete="off" spellcheck="false" />
				<small class="muted">Email addresses on those domains, separated by commas.</small>
			</label>
			<div class="row">
				<label><span>People allowed</span><input bind:value={draft.maxPeople} inputmode="numeric" autocomplete="off" /></label>
				<label><span>Storage in GB (0 for no limit)</span><input bind:value={draft.maxStorageGb} inputmode="numeric" autocomplete="off" /></label>
			</div>
			{#if draftProblem}<p class="problem" role="alert">{draftProblem}</p>{/if}
			<div class="row">
				<button type="submit" class="primary" disabled={saving}>{saving ? 'Saving' : 'Save organisation'}</button>
				<button type="button" onclick={() => (draft = null)}>Cancel</button>
			</div>
		</form>
	{/if}

	{#if orgs.length === 0 && !notice}
		<p class="muted">No organisations yet.</p>
	{:else}
		<ul aria-label="Organisations">
			{#each orgs as org (org.id)}
				<li>
					<div class="what">
						<h2>{org.name}</h2>
						<p>{org.domains.map(domainName).join(', ')}</p>
						<p class="muted">Run by {org.admins.join(', ')}</p>
						<p class="muted">{peopleUse(org.people, org.maxPeople)}. {storageUse(org.storageHeld, org.maxStorage)}.</p>
					</div>
					<div class="row">
						<button type="button" onclick={() => start(draftFromOrg(org))}>Edit<span class="sr"> {org.name}</span></button>
						{#if confirming === org.id}
							<button type="button" class="danger" onclick={() => onremove(org)}>Confirm remove<span class="sr"> {org.name}</span></button>
							<button type="button" onclick={() => (confirming = '')}>Keep</button>
						{:else}
							<button type="button" onclick={() => (confirming = org.id)}>Remove<span class="sr"> {org.name}</span></button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if orgs.length > 0}<p class="muted">Removing an organisation leaves its domains and people on the server.</p>{/if}
	{/if}

	{#if domains.length > 0}
		<section class="logos" aria-labelledby="logos-title">
			<h2 id="logos-title">Domain logos and sign-in</h2>
			<p class="muted">Shown on that domain's sign-in page and to its people.</p>
			{#each domains as domain (domain.id)}
				<LogoEditor domain={domain.name} onupload={onlogo} onremove={onlogoremove} />
				{@render sso?.(domain.name)}
			{/each}
		</section>
	{/if}
</section>

<style>
	.logos { display: grid; gap: var(--y-2xs); }
	.orgs { display: grid; gap: var(--y-s); min-width: 0; }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1.125rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; display: grid; gap: var(--y-2xs); }
	.row { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	input:not([type='checkbox']), button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
	.form { display: grid; gap: 0.75rem; max-width: 36rem; padding: var(--y-s) var(--x-s); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.form label:not(.check) { display: grid; gap: 0.25rem; }
	.form label > span, legend { font-size: 0.875rem; color: var(--color-muted); }
	.form input:not([type='checkbox']) { width: 100%; }
	.row > label { flex: 1 1 12rem; }
	fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 0.25rem; }
	.check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; overflow-wrap: anywhere; }
	.check input { width: 1.25rem; height: 1.25rem; }
	li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--x-s); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.what { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 18rem; overflow-wrap: anywhere; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
