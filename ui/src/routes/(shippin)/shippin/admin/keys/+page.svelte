<script lang="ts">
	import { onMount } from 'svelte';
	import KeysAdmin from '$lib/shippin/keys/KeysAdmin.svelte';
	import LessonFor from '$lib/shippin/LessonFor.svelte';
	import {
		authorKeys,
		loadKeys,
		missingServices,
		replaceKey,
		replacedText,
		type KeysReport,
		type NewKeyDraft,
		type ServiceName
	} from '$lib/shippin/keys/keys-admin';
	import { mcplEmit } from '$lib/mcpl/events';

	let report = $state<KeysReport | null>(null);
	let notice = $state('Loading.');
	let problem = $state('');
	let result = $state('');

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			report = await loadKeys();
			notice = '';
			// The server confirms every service has its key: that step is done.
			if (missingServices(report).length === 0) mcplEmit('keys.authored', 'keys');
		} catch (err) {
			notice = message(err, 'The keys could not be loaded.');
		}
	}

	onMount(load);

	async function author() {
		problem = '';
		result = '';
		try {
			const done = await authorKeys();
			result = done.made.length ? `Made ${done.made.length === 1 ? 'one key' : `${done.made.length} keys`} at random.` : 'Every service already had its key.';
			await load();
		} catch (err) {
			problem = message(err, 'The keys could not be made.');
		}
	}

	async function replace(service: ServiceName, draft: NewKeyDraft) {
		problem = '';
		result = '';
		try {
			const done = await replaceKey(service, draft);
			mcplEmit('keys.replaced', 'keys');
			result = replacedText(service, done);
			await load();
		} catch (err) {
			problem = message(err, 'The key could not be replaced.');
		}
	}
</script>

<svelte:head><title>Keys</title></svelte:head>

<LessonFor id="author-your-keys" />
<KeysAdmin {report} {notice} {problem} {result} onauthor={author} onreplace={replace} />
