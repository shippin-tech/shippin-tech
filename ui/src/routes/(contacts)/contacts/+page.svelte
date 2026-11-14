<script lang="ts">
	import { onMount } from 'svelte';
	import Contact from '$lib/catalog/contact/Contact.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import {
		createAddressBook,
		deleteAddressBook,
		deletePerson,
		listAddressBooks,
		listPeople,
		savePerson,
		type AddressBook,
		type Person,
		type PersonDraft
	} from '$lib/adapter/people';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'keep-your-contacts')!;
	const who = account()?.username ?? '';

	let people = $state<Person[]>([]);
	let books = $state<AddressBook[]>([]);
	let notice = $state('Loading contacts.');
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
			[people, books] = await Promise.all([listPeople(), listAddressBooks()]);
			notice = '';
		} catch (err) {
			notice = message(err, 'Contacts could not be loaded.');
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

	function save(draft: PersonDraft, original?: Person) {
		return run(
			() => savePerson(draft, original),
			'The contact could not be saved.',
			() => {
				if (original) mcplEmit('contact.card.updated', 'contacts');
				else mcplEmit('contact.card.created', 'contacts');
			}
		);
	}
</script>

<section class="workspace">
	<Lesson {lesson} {progress} ondismiss={dismissLesson} />
	<Contact
		{people}
		{books}
		{notice}
		{problem}
		onsave={save}
		ondelete={(person) => run(() => deletePerson(person.id), 'The contact could not be deleted.', () => mcplEmit('contact.card.deleted', 'contacts'))}
		onaddbook={(name) => run(() => createAddressBook(name), 'The address book could not be created.', () => mcplEmit('contact.book.created', 'contacts'))}
		ondeletebook={(book) => run(() => deleteAddressBook(book.id), 'The address book could not be deleted.')}
	/>
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
