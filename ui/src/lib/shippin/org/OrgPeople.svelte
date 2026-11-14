<script lang="ts">
	import { bytesText } from '$lib/shippin/resources/resources-call';
	import { emptyOrgPersonDraft, limitProblem, orgPersonProblem, peopleUse, storageText, type MyOrg, type OrgPerson, type OrgPersonDraft } from './orgs-call';

	let {
		org,
		notice,
		problem,
		onadd,
		onsave,
		onremove,
		onaddalias,
		onremovealias
	}: {
		org: MyOrg | null;
		notice: string;
		problem: string;
		onadd: (draft: OrgPersonDraft) => Promise<boolean>;
		onsave: (person: OrgPerson, change: { password?: string; limitGb?: number; fullName?: string }) => Promise<boolean>;
		onremove: (person: OrgPerson) => void;
		onaddalias: (person: OrgPerson, alias: string) => Promise<boolean>;
		onremovealias: (person: OrgPerson, alias: string) => void;
	} = $props();

	let adding = $state<OrgPersonDraft | null>(null);
	let addProblem = $state('');
	let editingId = $state('');
	let editFullName = $state('');
	let editPassword = $state('');
	let editLimit = $state('');
	let editProblem = $state('');
	let newAlias = $state('');
	let confirming = $state('');
	let busy = $state(false);

	const needsLimit = $derived((org?.maxStorage ?? 0) > 0);
	const editing = $derived(org?.people.find((person) => person.id === editingId) ?? null);

	function startAdd() {
		adding = emptyOrgPersonDraft(org?.domains[0]?.id ?? '');
		addProblem = '';
		editingId = '';
	}

	function startEdit(person: OrgPerson) {
		editingId = person.id;
		editFullName = person.fullName;
		editPassword = '';
		editLimit = person.limit === null ? '' : String(person.limit / 1024 ** 3);
		editProblem = '';
		newAlias = '';
		adding = null;
		confirming = '';
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		if (!adding) return;
		addProblem = orgPersonProblem(adding, needsLimit);
		if (addProblem) return;
		busy = true;
		const done = await onadd(adding);
		busy = false;
		if (done) adding = null;
	}

	async function submitEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!editing) return;
		editProblem = limitProblem(editLimit, needsLimit);
		if (editProblem) return;
		const change: { password?: string; limitGb?: number; fullName?: string } = { fullName: editFullName };
		if (editPassword) change.password = editPassword;
		if (editLimit.trim() !== '') change.limitGb = Number(editLimit);
		busy = true;
		const done = await onsave(editing, change);
		busy = false;
		if (done) editingId = '';
	}

	async function submitAlias() {
		if (!editing || !newAlias.trim()) return;
		busy = true;
		const done = await onaddalias(editing, newAlias.trim());
		busy = false;
		if (done) newAlias = '';
	}
</script>

<section class="people" aria-labelledby="people-title">
	<header>
		<h1 id="people-title">People</h1>
		{#if org}<p class="muted">{peopleUse(org.people.length, org.maxPeople)}</p>{/if}
	</header>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	{#if org}
		<div><button type="button" class="primary" onclick={startAdd}>Add a person</button></div>

		{#if adding}
			<form class="form" onsubmit={submitAdd} aria-label="Add a person" novalidate>
				<div class="row">
					<label><span>Address</span><input bind:value={adding.name} autocomplete="off" spellcheck="false" /></label>
					<label>
						<span>Domain</span>
						<select bind:value={adding.domainId}>
							{#each org.domains as domain (domain.id)}<option value={domain.id}>{domain.name}</option>{/each}
						</select>
					</label>
				</div>
				<label><span>Full name</span><input bind:value={adding.fullName} autocomplete="off" /></label>
				<label><span>Password</span><input bind:value={adding.password} type="password" autocomplete="new-password" /></label>
				<label><span>Storage in GB{needsLimit ? '' : ' (optional)'}</span><input bind:value={adding.limitGb} inputmode="decimal" autocomplete="off" /></label>
				{#if addProblem}<p class="problem" role="alert">{addProblem}</p>{/if}
				<div class="row">
					<button type="submit" class="primary" disabled={busy}>{busy ? 'Adding' : 'Add person'}</button>
					<button type="button" onclick={() => (adding = null)}>Cancel</button>
				</div>
			</form>
		{/if}

		{#if editing}
			<form class="form" onsubmit={submitEdit} aria-label="Edit {editing.email}" novalidate>
				<label><span>Full name</span><input bind:value={editFullName} autocomplete="off" /></label>
				<label><span>New password (leave empty to keep it)</span><input bind:value={editPassword} type="password" autocomplete="new-password" /></label>
				<label><span>Storage in GB</span><input bind:value={editLimit} inputmode="decimal" autocomplete="off" /></label>
				{#if editProblem}<p class="problem" role="alert">{editProblem}</p>{/if}
				<div class="row">
					<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving' : 'Save changes'}</button>
					<button type="button" onclick={() => (editingId = '')}>Close</button>
				</div>
				<fieldset>
					<legend>Other addresses</legend>
					{#if editing.aliases.length}
						<ul class="aliases">
							{#each editing.aliases as alias (alias)}
								<li>{alias} <button type="button" onclick={() => onremovealias(editing!, alias.split('@')[0])}>Remove<span class="sr"> {alias}</span></button></li>
							{/each}
						</ul>
					{/if}
					<div class="row">
						<label><span>New address</span><input bind:value={newAlias} autocomplete="off" spellcheck="false" /></label>
						<button type="button" disabled={busy} onclick={submitAlias}>Add address</button>
					</div>
				</fieldset>
			</form>
		{/if}

		<ul class="list" aria-label="People">
			{#each org.people as person (person.id)}
				<li>
					<div class="what">
						<h2>{person.email}</h2>
						<p class="muted">{person.fullName ? `${person.fullName}. ` : ''}{person.limit === null ? 'No storage limit' : `${storageText(person.limit)} of storage`}{person.admin ? '. Administrator' : ''}</p>
						<p class="muted">Using {bytesText(person.used)}</p>
					</div>
					<div class="row">
						{#if person.protected}
							<span class="muted">Managed by the server's administrators</span>
						{:else}
							<button type="button" onclick={() => startEdit(person)}>Edit<span class="sr"> {person.email}</span></button>
							{#if !person.admin}
								{#if confirming === person.id}
									<button type="button" class="danger" onclick={() => onremove(person)}>Confirm remove<span class="sr"> {person.email}</span></button>
									<button type="button" onclick={() => (confirming = '')}>Keep</button>
								{:else}
									<button type="button" onclick={() => (confirming = person.id)}>Remove<span class="sr"> {person.email}</span></button>
								{/if}
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.people { display: grid; gap: var(--y-s); min-width: 0; }
	header { display: grid; gap: 0.25rem; }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; display: grid; gap: var(--y-2xs); }
	.row { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	input, select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
	.form { display: grid; gap: 0.75rem; max-width: 36rem; padding: var(--y-s) var(--x-s); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.form label { display: grid; gap: 0.25rem; }
	.form label > span, legend { font-size: 0.875rem; color: var(--color-muted); }
	.form input, .form select { width: 100%; }
	.row > label { flex: 1 1 12rem; }
	fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
	.aliases li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; overflow-wrap: anywhere; }
	.list li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--x-s); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.what { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 18rem; overflow-wrap: anywhere; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
