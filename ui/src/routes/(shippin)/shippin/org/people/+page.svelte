<script lang="ts">
	import { onMount } from 'svelte';
	import OrgPeople from '$lib/shippin/org/OrgPeople.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import { addOrgAlias, addOrgPerson, loadMyOrg, removeOrgAlias, removeOrgPerson, updateOrgPerson, type MyOrg, type OrgPerson, type OrgPersonDraft } from '$lib/shippin/org/orgs';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'run-your-organisation')!;
	const who = account()?.username ?? '';

	let org = $state<MyOrg | null>(null);
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
			org = await loadMyOrg();
			notice = '';
		} catch (err) {
			notice = message(err, 'People could not be loaded.');
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
			return false;
		}
	}
</script>

<svelte:head><title>People</title></svelte:head>

<Lesson {lesson} {progress} ondismiss={dismissLesson} />
<OrgPeople
	{org}
	{notice}
	{problem}
	onadd={(draft: OrgPersonDraft) => act(() => addOrgPerson(draft), 'The person could not be added.', () => mcplEmit('org.person.added', 'org'))}
	onsave={(person: OrgPerson, change) => act(() => updateOrgPerson(person.id, change), 'The changes could not be saved.', () => mcplEmit('org.person.updated', 'org'))}
	onremove={(person: OrgPerson) => void act(() => removeOrgPerson(person.id), 'The person could not be removed.', () => mcplEmit('org.person.removed', 'org'))}
	onaddalias={(person: OrgPerson, alias: string) => act(() => addOrgAlias(person.id, alias), 'The address could not be added.', () => mcplEmit('org.alias.added', 'org'))}
	onremovealias={(person: OrgPerson, alias: string) => void act(() => removeOrgAlias(person.id, alias), 'The address could not be removed.', () => mcplEmit('org.alias.removed', 'org'))}
/>
