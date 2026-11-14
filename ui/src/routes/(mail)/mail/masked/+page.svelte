<script lang="ts">
	import { onMount } from 'svelte';
	import MaskedAddresses from '$lib/catalog/masked/MaskedAddresses.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import { createMasked, loadMasked, removeMasked, setMaskedEnabled, type MaskedAddress } from '$lib/adapter/masked';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'mask-your-address')!;
	const who = account()?.username ?? '';

	let addresses = $state<MaskedAddress[]>([]);
	let limit = $state(0);
	let notice = $state('Loading your masked addresses.');
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
			({ addresses, limit } = await loadMasked());
			notice = '';
		} catch (err) {
			notice = message(err, 'Your masked addresses could not be loaded.');
		}
	}

	onMount(load);

	async function create(label: string): Promise<boolean> {
		problem = '';
		try {
			await createMasked(label);
			mcplEmit('masked.created', 'masked');
			await load();
			return true;
		} catch (err) {
			problem = message(err, 'A new address could not be made.');
			return false;
		}
	}

	async function toggle(item: MaskedAddress, enabled: boolean) {
		problem = '';
		try {
			await setMaskedEnabled(item, enabled);
			mcplEmit('masked.switched', 'masked', { enabled });
		} catch (err) {
			problem = message(err, 'The address could not be changed.');
		}
		await load();
	}

	async function remove(item: MaskedAddress) {
		problem = '';
		try {
			await removeMasked(item);
			mcplEmit('masked.removed', 'masked');
			await load();
		} catch (err) {
			problem = message(err, 'The address could not be removed.');
		}
	}
</script>

<svelte:head><title>Masked addresses</title></svelte:head>

<Lesson {lesson} {progress} ondismiss={dismissLesson} />
<MaskedAddresses {addresses} {limit} {notice} {problem} oncreate={create} ontoggle={toggle} onremove={remove} />
