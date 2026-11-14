<script lang="ts">
	import { KEPT_PAGE, keptFor, keptIntro, messageSize, subjectOrPlaceholder, type HeldAccount, type KeptMessage } from '$lib/shippin/recover/recover-call';

	let {
		keepDays,
		accounts,
		people,
		person,
		messages,
		notice,
		problem,
		result,
		onperson,
		onrestoreaccount,
		onrestoremessage,
		onmore
	}: {
		keepDays: number;
		accounts: HeldAccount[];
		people: { id: string; email: string }[];
		person: string;
		messages: KeptMessage[];
		notice: string;
		problem: string;
		result: string;
		onperson: (id: string) => void;
		onrestoreaccount: (account: HeldAccount) => void;
		onrestoremessage: (message: KeptMessage) => void;
		onmore: () => void;
	} = $props();

	const now = $derived(Math.floor(Date.now() / 1000));
</script>

<section class="recover" aria-labelledby="recover-title">
	<header>
		<h1 id="recover-title">Recover deleted</h1>
		<p class="muted">{keptIntro(keepDays)} Restored messages go back to the Inbox.</p>
	</header>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#if result}<p role="status">{result}</p>{/if}

	<section aria-labelledby="held-title">
		<h2 id="held-title">Deleted accounts</h2>
		<p class="muted">A restored account comes back with its mail and files. Anything others had shared with it needs sharing again.</p>
		{#if accounts.length === 0}
			<p class="muted">No deleted accounts are being kept.</p>
		{:else}
			<ul class="items" aria-label="Deleted accounts">
				{#each accounts as account (account.id)}
					<li>
						<div class="what">
							<h3>{account.email}</h3>
							<p class="muted">{account.kind === 'team' ? 'Team' : 'Person'}. Deleted {new Date(account.deletedAt * 1000).toLocaleString()}. {keptFor(account.until, now)}.</p>
						</div>
						<button type="button" onclick={() => onrestoreaccount(account)}>Restore<span class="sr"> {account.email}</span></button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="kept-title">
		<h2 id="kept-title">Deleted messages</h2>
		<label>
			<span>Person</span>
			<select value={person} onchange={(event) => onperson(event.currentTarget.value)}>
				<option value="">Choose a person</option>
				{#each people as item (item.id)}<option value={item.id}>{item.email}</option>{/each}
			</select>
		</label>
		{#if person && messages.length === 0 && !notice}
			<p class="muted">No deleted messages are being kept for this person.</p>
		{/if}
		{#if messages.length > 0}
			<ul class="items" aria-label="Deleted messages">
				{#each messages as message (message.id)}
					<li>
						<div class="what">
							<h3>{subjectOrPlaceholder(message.subject)}</h3>
							<p class="muted">From {message.from || 'an unknown sender'}. {messageSize(message.size)}. Deleted {new Date(message.deletedAt * 1000).toLocaleString()}. {keptFor(message.until, now)}.</p>
						</div>
						<button type="button" onclick={() => onrestoremessage(message)}>Restore<span class="sr"> {subjectOrPlaceholder(message.subject)}</span></button>
					</li>
				{/each}
			</ul>
			{#if messages.length % KEPT_PAGE === 0}
				<button type="button" onclick={onmore}>Show more</button>
			{/if}
		{/if}
	</section>
</section>

<style>
	.recover, section { display: grid; gap: var(--y-2xs); min-width: 0; }
	.recover { gap: var(--y-s); }
	h1, h2, h3, p, ul { margin: 0; }
	h2 { font-size: 1.125rem; }
	h3 { font-size: 1rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; }
	select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { cursor: pointer; justify-self: start; }
	label { display: grid; gap: 0.25rem; max-width: 28rem; }
	label span { font-size: 0.875rem; color: var(--color-muted); }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
	.items { display: grid; gap: var(--y-2xs); }
	.items li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--x-s); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.what { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 18rem; overflow-wrap: anywhere; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
