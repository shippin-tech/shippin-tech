<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import DocList from '$lib/catalog/doc/DocList.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import { createDocument, docFileName, listDocuments } from '$lib/adapter/docs';
	import { removeNode, renameNode, type DriveNode } from '$lib/adapter/drive';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'write-a-document')!;
	const who = account()?.username ?? '';

	let documents = $state<DriveNode[]>([]);
	let notice = $state('Loading documents.');
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
			documents = await listDocuments();
			notice = '';
		} catch (err) {
			notice = message(err, 'Documents could not be loaded.');
		}
	}

	onMount(load);

	function open(node: DriveNode) {
		const params = new URLSearchParams({ id: node.id });
		if (node.drive) params.set('drive', node.drive);
		void goto(`/docs/edit?${params.toString()}`);
	}

	async function create(title: string): Promise<boolean> {
		problem = '';
		try {
			const id = await createDocument(title);
			mcplEmit('doc.document.created', 'docs');
			await goto(`/docs/edit?id=${encodeURIComponent(id)}`);
			return true;
		} catch (err) {
			problem = message(err, 'The document could not be created.');
			return false;
		}
	}

	async function change(action: () => Promise<void>, fallback: string, after?: () => void): Promise<boolean> {
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

<section class="workspace">
	<Lesson {lesson} {progress} ondismiss={dismissLesson} />
	<DocList
		{documents}
		{notice}
		{problem}
		onnew={create}
		onopen={open}
		onrename={(node, title) => change(() => renameNode(node.id, docFileName(title), node.drive), 'The document could not be renamed.')}
		ondelete={(node) => change(() => removeNode(node.id, node.drive), 'The document could not be deleted.', () => mcplEmit('doc.document.deleted', 'docs'))}
	/>
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
