<script lang="ts">
	import { onMount } from 'svelte';
	import RecoverAdmin from '$lib/shippin/recover/RecoverAdmin.svelte';
	import { loadDirectory } from '$lib/shippin/people/team';
	import {
		listHeldAccounts,
		listKeptMessages,
		restoreHeldAccount,
		restoreKeptMessage,
		subjectOrPlaceholder,
		type HeldAccount,
		type KeptMessage
	} from '$lib/shippin/recover/recover';
	import { mcplEmit } from '$lib/mcpl/events';

	let keepDays = $state(30);
	let accounts = $state<HeldAccount[]>([]);
	let people = $state<{ id: string; email: string }[]>([]);
	let person = $state('');
	let messages = $state<KeptMessage[]>([]);
	let notice = $state('Loading.');
	let problem = $state('');
	let result = $state('');

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			const [held, directory] = await Promise.all([listHeldAccounts(), loadDirectory()]);
			keepDays = held.keepDays;
			accounts = held.accounts;
			people = directory.people.map((item) => ({ id: item.id, email: item.email })).sort((a, b) => a.email.localeCompare(b.email));
			notice = '';
		} catch (err) {
			notice = message(err, 'Deleted items could not be loaded.');
		}
	}

	onMount(load);

	function clear() {
		problem = '';
		result = '';
	}

	async function choose(id: string) {
		clear();
		person = id;
		messages = [];
		if (!id) return;
		try {
			messages = await listKeptMessages(id);
		} catch (err) {
			problem = message(err, 'Deleted messages could not be loaded.');
		}
	}

	async function more() {
		clear();
		try {
			messages = [...messages, ...(await listKeptMessages(person, messages.at(-1)?.id))];
		} catch (err) {
			problem = message(err, 'Deleted messages could not be loaded.');
		}
	}

	async function restoreAccount(account: HeldAccount) {
		clear();
		try {
			await restoreHeldAccount(account.id);
			mcplEmit('recover.account.restored', 'recover');
			result = `${account.email} is back.`;
			await load();
		} catch (err) {
			problem = message(err, 'The account could not be restored.');
		}
	}

	async function restoreMessage(item: KeptMessage) {
		clear();
		try {
			await restoreKeptMessage(person, item.id);
			mcplEmit('recover.message.restored', 'recover');
			result = `${subjectOrPlaceholder(item.subject)} is back in the Inbox.`;
			messages = messages.filter((other) => other.id !== item.id);
		} catch (err) {
			problem = message(err, 'The message could not be restored.');
		}
	}
</script>

<svelte:head><title>Recover deleted</title></svelte:head>

<RecoverAdmin
	{keepDays}
	{accounts}
	{people}
	{person}
	{messages}
	{notice}
	{problem}
	{result}
	onperson={choose}
	onrestoreaccount={restoreAccount}
	onrestoremessage={restoreMessage}
	onmore={more}
/>
