<script lang="ts">
	import type { MyOrg, OrgPerson, OrgTeam } from './orgs-call';

	let {
		org,
		notice,
		problem,
		oncreate,
		onremove,
		onmember
	}: {
		org: MyOrg | null;
		notice: string;
		problem: string;
		oncreate: (draft: { name: string; domainId: string; description: string }) => Promise<boolean>;
		onremove: (team: OrgTeam) => void;
		onmember: (team: OrgTeam, person: OrgPerson, member: boolean) => void;
	} = $props();

	let name = $state('');
	let domainId = $state('');
	let description = $state('');
	let local = $state('');
	let busy = $state(false);
	let confirming = $state('');

	const chosenDomain = $derived(domainId || org?.domains[0]?.id || '');
	const people = $derived(org?.people.filter((person) => !person.protected) ?? []);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		local = name.trim() ? '' : "Enter the part of the team's address before the @.";
		if (local) return;
		busy = true;
		const done = await oncreate({ name: name.trim(), domainId: chosenDomain, description });
		busy = false;
		if (done) {
			name = '';
			description = '';
		}
	}
</script>

<section class="teams" aria-labelledby="teams-title">
	<h1 id="teams-title">Teams</h1>
	<p class="muted">A team has its own address that reaches everyone on it.</p>
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	{#if org}
		<form onsubmit={submit} aria-label="New team" novalidate>
			<label><span>Team address</span><input bind:value={name} autocomplete="off" spellcheck="false" /></label>
			<label>
				<span>Domain</span>
				<select value={chosenDomain} onchange={(event) => (domainId = event.currentTarget.value)}>
					{#each org.domains as domain (domain.id)}<option value={domain.id}>{domain.name}</option>{/each}
				</select>
			</label>
			<label><span>What it is for</span><input bind:value={description} autocomplete="off" /></label>
			<button type="submit" class="primary" disabled={busy}>{busy ? 'Making it' : 'Make team'}</button>
			{#if local}<p class="problem" role="alert">{local}</p>{/if}
		</form>

		{#if org.teams.length === 0}
			<p class="muted">No teams yet.</p>
		{:else}
			<ul aria-label="Teams">
				{#each org.teams as team (team.id)}
					<li>
						<h2>{team.email}</h2>
						{#if team.description}<p class="muted">{team.description}</p>{/if}
						<fieldset>
							<legend>On this team</legend>
							{#each people as person (person.id)}
								<label class="check">
									<input type="checkbox" checked={person.teamIds.includes(team.id)} onchange={(event) => onmember(team, person, event.currentTarget.checked)} />
									{person.email}
								</label>
							{/each}
						</fieldset>
						<div class="row">
							{#if confirming === team.id}
								<button type="button" class="danger" onclick={() => onremove(team)}>Confirm remove<span class="sr"> {team.email}</span></button>
								<button type="button" onclick={() => (confirming = '')}>Keep</button>
							{:else}
								<button type="button" onclick={() => (confirming = team.id)}>Remove<span class="sr"> {team.email}</span></button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.teams { display: grid; gap: var(--y-s); min-width: 0; }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; display: grid; gap: var(--y-2xs); }
	form { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	form label { display: grid; gap: 0.25rem; flex: 1 1 12rem; }
	form label span, legend { font-size: 0.875rem; color: var(--color-muted); }
	form input, select { width: 100%; }
	input:not([type='checkbox']), select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	.problem { font-weight: 600; flex-basis: 100%; }
	.muted { color: var(--color-muted); }
	li { display: grid; gap: var(--y-2xs); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
	.check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; overflow-wrap: anywhere; }
	.check input { width: 1.25rem; height: 1.25rem; }
	.row { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
