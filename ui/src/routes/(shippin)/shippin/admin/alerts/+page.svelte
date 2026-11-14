<script lang="ts">
	import { onMount } from 'svelte';
	import AlertsAdmin from '$lib/shippin/alerts/AlertsAdmin.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import {
		alertCheckSummary,
		alertPayload,
		checkAlerts,
		draftFromAlert,
		loadAlerts,
		removeAlert,
		saveAlert,
		type AlertDraft,
		type AlertMetric,
		type AlertRule
	} from '$lib/shippin/alerts/alerts';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'watch-your-server')!;
	const who = account()?.username ?? '';

	let rules = $state<AlertRule[]>([]);
	let metrics = $state<AlertMetric[]>([]);
	let notice = $state('Loading alerts.');
	let problem = $state('');
	let result = $state('');
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
			({ rules, metrics } = await loadAlerts());
			notice = '';
		} catch (err) {
			notice = message(err, 'Alerts could not be loaded.');
		}
	}

	onMount(load);

	async function save(draft: AlertDraft): Promise<boolean> {
		problem = '';
		result = '';
		try {
			await saveAlert(alertPayload(draft));
			mcplEmit('alerts.rule.saved', 'alerts');
			await load();
			return true;
		} catch (err) {
			problem = message(err, 'The alert could not be saved.');
			return false;
		}
	}

	async function remove(rule: AlertRule) {
		problem = '';
		result = '';
		try {
			await removeAlert(rule.id);
			mcplEmit('alerts.rule.removed', 'alerts');
			await load();
		} catch (err) {
			problem = message(err, 'The alert could not be removed.');
		}
	}

	async function check() {
		problem = '';
		result = '';
		try {
			result = alertCheckSummary(await checkAlerts());
			mcplEmit('alerts.checked', 'alerts');
			await load();
		} catch (err) {
			problem = message(err, 'The alerts could not be checked.');
		}
	}
</script>

<svelte:head><title>Alerts</title></svelte:head>

<Lesson {lesson} {progress} ondismiss={dismissLesson} />
<AlertsAdmin
	{rules}
	{metrics}
	{notice}
	{problem}
	{result}
	onsave={save}
	ontoggle={(rule, enabled) => void save({ ...draftFromAlert(rule), enabled })}
	onremove={remove}
	oncheck={check}
/>
