<script lang="ts">
	import {
		displayName,
		draftFromPerson,
		filterPeople,
		membersOf,
		personProblem,
		teamProblem,
		type Person,
		type PersonDraft,
		type Team,
		type TeamDomain,
		type TeamDraft
	} from '$lib/shippin/people/team-call';
	import { formatValue } from '$lib/shippin/dashboard/stats-call';

	type Props = {
		people: readonly Person[];
		teams: readonly Team[];
		domains: readonly TeamDomain[];
		notice: string;
		problem: string;
		selfEmail: string;
		onaddperson: (draft: PersonDraft) => Promise<boolean>;
		onsaveperson: (person: Person, draft: PersonDraft) => Promise<boolean>;
		onremoveperson: (person: Person) => Promise<boolean>;
		onaddteam: (draft: TeamDraft) => Promise<boolean>;
		onremoveteam: (team: Team) => Promise<boolean>;
		onmember: (person: Person, team: Team, member: boolean) => Promise<boolean>;
	};

	let { people, teams, domains, notice, problem, selfEmail, onaddperson, onsaveperson, onremoveperson, onaddteam, onremoveteam, onmember }: Props = $props();

	type Panel =
		| { kind: 'none' }
		| { kind: 'new-person'; draft: PersonDraft }
		| { kind: 'edit-person'; person: Person; draft: PersonDraft }
		| { kind: 'remove-person'; person: Person }
		| { kind: 'new-team'; draft: TeamDraft }
		| { kind: 'team'; id: string }
		| { kind: 'remove-team'; team: Team };

	let tab = $state<'people' | 'teams'>('people');
	let panel = $state<Panel>({ kind: 'none' });
	let query = $state('');
	let teamFilter = $state('');
	let formError = $state('');
	let addMember = $state('');

	const shown = $derived(filterPeople(people, query, teamFilter));
	const openTeam = $derived(panel.kind === 'team' ? (teams.find((team) => team.id === (panel as { id: string }).id) ?? null) : null);
	const teamMembers = $derived(openTeam ? membersOf(people, openTeam.id) : []);
	const addable = $derived(openTeam ? people.filter((person) => !person.teamIds.includes(openTeam!.id)) : []);

	function teamName(id: string): string {
		return teams.find((team) => team.id === id)?.name ?? '';
	}

	function usage(person: Person): string {
		const used = formatValue(person.used, 'bytes');
		return person.limit ? `${used} of ${formatValue(person.limit, 'bytes')}` : `${used}, no limit`;
	}

	function open(next: Panel) {
		panel = next;
		formError = '';
		addMember = '';
	}

	function close() {
		open({ kind: 'none' });
	}

	function newPerson() {
		open({ kind: 'new-person', draft: { name: '', domainId: domains[0]?.id ?? '', fullName: '', password: '', role: 'user', limitGb: '', teamIds: [] } });
	}

	function newTeam() {
		open({ kind: 'new-team', draft: { name: '', domainId: domains[0]?.id ?? '', description: '' } });
	}

	async function submitPerson(event: SubmitEvent, draft: PersonDraft, person?: Person) {
		event.preventDefault();
		formError = personProblem(draft, !person);
		if (formError) return;
		if (await (person ? onsaveperson(person, draft) : onaddperson(draft))) close();
	}

	async function submitTeam(event: SubmitEvent, draft: TeamDraft) {
		event.preventDefault();
		formError = teamProblem(draft);
		if (formError) return;
		if (await onaddteam(draft)) close();
	}

	function toggleTeam(draft: PersonDraft, id: string, on: boolean) {
		draft.teamIds = on ? [...draft.teamIds, id] : draft.teamIds.filter((item) => item !== id);
	}

	async function addToTeam(event: SubmitEvent, team: Team) {
		event.preventDefault();
		const person = people.find((item) => item.id === addMember);
		if (person && (await onmember(person, team, true))) addMember = '';
	}
</script>

<section class="people">
	<h1>People and teams</h1>

	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to manage people.</p>
	{:else if notice}
		<p role="status">{notice}</p>
	{:else}
		<div class="tabs" role="group" aria-label="View">
			<button type="button" aria-pressed={tab === 'people'} onclick={() => { tab = 'people'; close(); }}>People ({people.length})</button>
			<button type="button" aria-pressed={tab === 'teams'} onclick={() => { tab = 'teams'; close(); }}>Teams ({teams.length})</button>
		</div>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		<div class="layout">
			<div class="main">
				{#if tab === 'people'}
					<div class="tools">
						<label><span class="sr">Search people</span><input type="search" aria-label="Search people" placeholder="Search" bind:value={query} /></label>
						{#if teams.length}
							<label>
								<span class="sr">Show team</span>
								<select aria-label="Show team" bind:value={teamFilter}>
									<option value="">Everyone</option>
									{#each teams as team (team.id)}<option value={team.id}>{team.name}</option>{/each}
								</select>
							</label>
						{/if}
						<button type="button" class="primary" onclick={newPerson}>Add person</button>
					</div>
					{#if shown.length === 0}
						<p class="empty">No one matches.</p>
					{:else}
						<div class="scroll">
							<table>
								<thead>
									<tr><th scope="col">Name</th><th scope="col" class="wide">Teams</th><th scope="col">Access</th><th scope="col" class="wide">Storage</th><th scope="col"><span class="sr">Actions</span></th></tr>
								</thead>
								<tbody>
									{#each shown as person (person.id)}
										<tr>
											<th scope="row"><strong>{displayName(person)}</strong><span class="muted">{person.email}</span></th>
											<td class="wide">{person.teamIds.map(teamName).filter(Boolean).join(', ')}</td>
											<td>{person.role === 'admin' ? 'Administrator' : person.role === 'custom' ? 'Custom' : 'Member'}</td>
											<td class="wide">{usage(person)}</td>
											<td class="actions">
												<button type="button" aria-label="Edit {person.email}" onclick={() => open({ kind: 'edit-person', person, draft: draftFromPerson(person) })}>Edit</button>
												{#if person.email !== selfEmail}
													<button type="button" aria-label="Remove {person.email}" onclick={() => open({ kind: 'remove-person', person })}>Remove</button>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{:else}
					<div class="tools"><button type="button" class="primary" onclick={newTeam}>New team</button></div>
					{#if teams.length === 0}
						<p class="empty">No teams yet. A team gets its own address that reaches everyone in it.</p>
					{:else}
						<div class="scroll">
							<table>
								<thead><tr><th scope="col">Team</th><th scope="col" class="wide">Address</th><th scope="col">People</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
								<tbody>
									{#each teams as team (team.id)}
										<tr>
											<th scope="row"><button type="button" class="link" onclick={() => open({ kind: 'team', id: team.id })}>{team.name}</button>{#if team.description}<span class="muted">{team.description}</span>{/if}</th>
											<td class="wide">{team.email}</td>
											<td>{membersOf(people, team.id).length}</td>
											<td class="actions"><button type="button" aria-label="Remove team {team.name}" onclick={() => open({ kind: 'remove-team', team })}>Remove</button></td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</div>

			{#if panel.kind !== 'none'}
				<section class="panel" aria-label="Details">
					{#if panel.kind === 'new-person' || panel.kind === 'edit-person'}
						{@const draft = panel.draft}
						{@const person = panel.kind === 'edit-person' ? panel.person : undefined}
						<form class="form" onsubmit={(event) => submitPerson(event, draft, person)}>
							<h2>{person ? `Edit ${person.email}` : 'Add a person'}</h2>
							<label><span>Full name</span><input bind:value={draft.fullName} /></label>
							{#if !person}
								<label><span>Username</span><input bind:value={draft.name} autocomplete="off" /></label>
								<label>
									<span>Domain</span>
									<select bind:value={draft.domainId}>
										{#each domains as domain (domain.id)}<option value={domain.id}>{domain.name}</option>{/each}
									</select>
								</label>
							{/if}
							<label><span>{person ? 'New password (leave empty to keep it)' : 'Password'}</span><input type="password" autocomplete="new-password" bind:value={draft.password} /></label>
							{#if draft.role !== 'custom'}
								<label>
									<span>Access</span>
									<select bind:value={draft.role}>
										<option value="user">Member</option>
										<option value="admin">Administrator</option>
									</select>
								</label>
							{/if}
							<label><span>Storage limit in GB (empty for none)</span><input inputmode="decimal" bind:value={draft.limitGb} /></label>
							{#if teams.length}
								<fieldset>
									<legend>Teams</legend>
									{#each teams as team (team.id)}
										<label class="check">
											<input type="checkbox" checked={draft.teamIds.includes(team.id)} onchange={(event) => toggleTeam(draft, team.id, event.currentTarget.checked)} />
											<span>{team.name}</span>
										</label>
									{/each}
								</fieldset>
							{/if}
							{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
							<div class="actions">
								<button type="submit" class="primary">{person ? 'Save changes' : 'Add person'}</button>
								<button type="button" onclick={close}>Cancel</button>
							</div>
						</form>
					{:else if panel.kind === 'remove-person'}
						{@const person = panel.person}
						<p role="alert">Remove {person.email}? Their mail, files and calendars go with them. You can bring them back from Recover deleted while the server still keeps them.</p>
						<div class="actions">
							<button type="button" class="danger" onclick={async () => { if (await onremoveperson(person)) close(); }}>Remove person</button>
							<button type="button" onclick={close}>Cancel</button>
						</div>
					{:else if panel.kind === 'new-team'}
						{@const draft = panel.draft}
						<form class="form" onsubmit={(event) => submitTeam(event, draft)}>
							<h2>New team</h2>
							<label><span>Team name</span><input bind:value={draft.name} autocomplete="off" /></label>
							<label>
								<span>Domain</span>
								<select bind:value={draft.domainId}>
									{#each domains as domain (domain.id)}<option value={domain.id}>{domain.name}</option>{/each}
								</select>
							</label>
							<label><span>Description</span><input bind:value={draft.description} /></label>
							{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
							<div class="actions">
								<button type="submit" class="primary">Create team</button>
								<button type="button" onclick={close}>Cancel</button>
							</div>
						</form>
					{:else if panel.kind === 'remove-team'}
						{@const team = panel.team}
						<p role="alert">Remove the team {team.name}? People stay; only the team and its address go.</p>
						<div class="actions">
							<button type="button" class="danger" onclick={async () => { if (await onremoveteam(team)) close(); }}>Remove team</button>
							<button type="button" onclick={close}>Cancel</button>
						</div>
					{:else if openTeam}
						{@const team = openTeam}
						<h2>{team.name}</h2>
						<p class="muted">{team.email}</p>
						{#if teamMembers.length === 0}
							<p class="muted">No one is in this team yet.</p>
						{:else}
							<ul class="members" aria-label="Team members">
								{#each teamMembers as person (person.id)}
									<li>
										<span>{displayName(person)}</span>
										<button type="button" aria-label="Take {person.email} off the team" onclick={() => onmember(person, team, false)}>Take off</button>
									</li>
								{/each}
							</ul>
						{/if}
						{#if addable.length}
							<form class="add" onsubmit={(event) => addToTeam(event, team)}>
								<label>
									<span>Add someone</span>
									<select bind:value={addMember}>
										<option value="">Choose a person</option>
										{#each addable as person (person.id)}<option value={person.id}>{displayName(person)}</option>{/each}
									</select>
								</label>
								<button type="submit" disabled={!addMember}>Add to team</button>
							</form>
						{/if}
						<div class="actions"><button type="button" onclick={close}>Close</button></div>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</section>

<style>
	.people { display: grid; gap: var(--y-s); min-width: 0; }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1.125rem; }
	ul { padding: 0; list-style: none; }
	.tabs, .tools, .add, .actions { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	input, select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); box-sizing: border-box; }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary, button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	button.link { border: 0; background: none; padding: 0; text-align: start; text-decoration: underline; }
	.problem { font-weight: 600; }
	.muted, .empty { color: var(--color-muted); }
	.layout { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--x-s); align-items: start; }
	.main { display: grid; gap: var(--y-2xs); min-width: 0; }
	.scroll { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border); text-align: start; vertical-align: middle; }
	thead th { color: var(--color-muted); font-size: 0.875rem; }
	th[scope='row'] { font-weight: normal; display: grid; gap: 0.125rem; overflow-wrap: anywhere; }
	td.actions { justify-content: flex-end; }
	.panel { width: min(100%, 22rem); display: grid; gap: var(--y-2xs); padding: var(--y-s) var(--x-s); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); overflow-wrap: anywhere; }
	.form { display: grid; gap: 0.75rem; }
	.form label, .add label { display: grid; gap: 0.25rem; }
	.form label span, .add label span, legend { font-size: 0.875rem; color: var(--color-muted); }
	.form input:not([type='checkbox']), .form select { width: 100%; }
	fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 0.25rem; }
	.form .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; }
	.check input { min-height: auto; width: 1.25rem; height: 1.25rem; }
	.members { display: grid; gap: 0.25rem; }
	.members li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (max-width: 64rem) { .layout { grid-template-columns: minmax(0, 1fr); } .panel { width: auto; } }
	@media (max-width: 48rem) { .wide { display: none; } }
</style>
