<script lang="ts">
	import { onMount } from 'svelte';
	import OrgTeams from '$lib/shippin/org/OrgTeams.svelte';
	import LessonFor from '$lib/shippin/LessonFor.svelte';
	import { createOrgTeam, loadMyOrg, removeOrgTeam, setOrgTeamMember, type MyOrg, type OrgPerson, type OrgTeam } from '$lib/shippin/org/orgs';
	import { mcplEmit } from '$lib/mcpl/events';

	let org = $state<MyOrg | null>(null);
	let notice = $state('Loading teams.');
	let problem = $state('');

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			org = await loadMyOrg();
			notice = '';
		} catch (err) {
			notice = message(err, 'Teams could not be loaded.');
		}
	}

	onMount(load);

	async function act(action: () => Promise<unknown>, fallback: string, after: () => void): Promise<boolean> {
		problem = '';
		try {
			await action();
			after();
			await load();
			return true;
		} catch (err) {
			problem = message(err, fallback);
			await load();
			return false;
		}
	}
</script>

<svelte:head><title>Teams</title></svelte:head>

<LessonFor id="shape-your-organisation" />
<OrgTeams
	{org}
	{notice}
	{problem}
	oncreate={(draft) => act(() => createOrgTeam(draft), 'The team could not be made.', () => mcplEmit('org.team.created', 'org'))}
	onremove={(team: OrgTeam) => void act(() => removeOrgTeam(team.id), 'The team could not be removed.', () => mcplEmit('org.team.removed', 'org'))}
	onmember={(team: OrgTeam, person: OrgPerson, member: boolean) => void act(() => setOrgTeamMember(team.id, person.id, member), 'The team could not be changed.', () => mcplEmit('org.member.changed', 'org', { added: member }))}
/>
