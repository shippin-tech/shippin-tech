<script lang="ts">
	import { onMount } from 'svelte';
	import PeopleAdmin from '$lib/shippin/people/PeopleAdmin.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import {
		createPerson,
		createTeam,
		loadDirectory,
		removeAccount,
		setMembership,
		updatePerson,
		type Person,
		type PersonDraft,
		type Team,
		type TeamDomain,
		type TeamDraft
	} from '$lib/shippin/people/team';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'run-your-team')!;
	const who = account()?.username ?? '';

	let people = $state<Person[]>([]);
	let teams = $state<Team[]>([]);
	let domains = $state<TeamDomain[]>([]);
	let notice = $state('Loading people.');
	let problem = $state('');
	let progress = $state(loadProgress(who, lesson));

	$effect(() => {
		$lessonsChanged;
		progress = loadProgress(who, lesson);
	});

	function dismissLesson() {
		progress = { ...progress, dismissed: true };
		saveProgress(who, lesson, progress);
		void pushLessonProgress(lesson.id, progress);
	}

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			({ people, teams, domains } = await loadDirectory());
			notice = '';
		} catch (err) {
			notice = message(err, 'People could not be loaded.');
		}
	}

	onMount(load);

	async function run(action: () => Promise<unknown>, fallback: string, after?: () => void): Promise<boolean> {
		problem = '';
		try {
			await action();
			after?.();
			await load();
			return true;
		} catch (err) {
			problem = message(err, fallback);
			return false;
		}
	}
</script>

<svelte:head><title>People and teams</title></svelte:head>

<Lesson {lesson} {progress} ondismiss={dismissLesson} />
<PeopleAdmin
	{people}
	{teams}
	{domains}
	{notice}
	{problem}
	selfEmail={who}
	onaddperson={(draft: PersonDraft) => run(() => createPerson(draft), 'The person could not be added.', () => mcplEmit('team.person.added', 'people'))}
	onsaveperson={(person: Person, draft: PersonDraft) => run(() => updatePerson(person, draft), 'The changes could not be saved.', () => mcplEmit('team.person.updated', 'people'))}
	onremoveperson={(person: Person) => run(() => removeAccount(person.id), 'The person could not be removed.', () => mcplEmit('team.person.removed', 'people'))}
	onaddteam={(draft: TeamDraft) => run(() => createTeam(draft), 'The team could not be created.', () => mcplEmit('team.group.created', 'people'))}
	onremoveteam={(team: Team) => run(() => removeAccount(team.id), 'The team could not be removed.', () => mcplEmit('team.group.removed', 'people'))}
	onmember={(person: Person, team: Team, member: boolean) =>
		run(() => setMembership(person, team.id, member), 'The team could not be changed.', () => mcplEmit('team.member.changed', 'people', { added: member }))}
/>
