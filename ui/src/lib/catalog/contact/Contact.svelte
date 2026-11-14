<script lang="ts">
	import {
		draftFromPerson,
		emptyPersonDraft,
		initials,
		personProblem,
		searchPeople,
		type AddressBook,
		type Person,
		type PersonDraft
	} from '$lib/adapter/people-call';

	type Props = {
		people: readonly Person[];
		books: readonly AddressBook[];
		notice: string;
		problem: string;
		onsave: (draft: PersonDraft, original?: Person) => Promise<boolean>;
		ondelete: (person: Person) => Promise<boolean>;
		onaddbook: (name: string) => Promise<boolean>;
		ondeletebook: (book: AddressBook) => Promise<boolean>;
	};

	let { people, books, notice, problem, onsave, ondelete, onaddbook, ondeletebook }: Props = $props();

	type Panel =
		| { kind: 'none' }
		| { kind: 'detail'; id: string }
		| { kind: 'edit'; draft: PersonDraft; original?: Person }
		| { kind: 'confirm-delete'; person: Person };

	let panel = $state<Panel>({ kind: 'none' });
	let query = $state('');
	let book = $state('');
	let formError = $state('');
	let addingBook = $state(false);
	let bookName = $state('');

	const writable = $derived(books.filter((item) => item.canWrite));
	const shown = $derived(searchPeople(book ? people.filter((person) => person.addressBookIds.includes(book)) : people, query));
	const open = $derived(panel.kind === 'detail' ? (people.find((person) => person.id === (panel as { id: string }).id) ?? null) : null);

	function close() {
		panel = { kind: 'none' };
		formError = '';
	}

	function startNew() {
		formError = '';
		panel = { kind: 'edit', draft: emptyPersonDraft(book || (writable[0]?.id ?? '')) };
	}

	function startEdit(person: Person) {
		formError = '';
		panel = { kind: 'edit', draft: draftFromPerson(person), original: person };
	}

	async function submit(event: SubmitEvent, draft: PersonDraft, original?: Person) {
		event.preventDefault();
		formError = personProblem(draft);
		if (formError) return;
		if (await onsave(draft, original)) close();
	}

	async function remove(person: Person) {
		if (await ondelete(person)) close();
	}

	async function addBook(event: SubmitEvent) {
		event.preventDefault();
		if (!bookName.trim()) return;
		if (await onaddbook(bookName)) {
			bookName = '';
			addingBook = false;
		}
	}
</script>

<section class="people">
	<header class="top">
		<h1>Contacts</h1>
		{#if !notice}
			<div class="tools">
				<label>
					<span class="sr">Search contacts</span>
					<input type="search" placeholder="Search" aria-label="Search contacts" bind:value={query} />
				</label>
				<button type="button" class="primary" onclick={startNew}>New contact</button>
			</div>
		{/if}
	</header>

	{#if notice === 'sign-in required'}
		<p><a href="/login">Sign in</a> to see your contacts.</p>
	{:else if notice}
		<p role="status">{notice}</p>
	{:else}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		<div class="layout">
			<aside aria-label="Address books">
				<h2>Address books</h2>
				<ul>
					<li><button type="button" aria-pressed={book === ''} onclick={() => (book = '')}>All contacts</button></li>
					{#each books as item (item.id)}
						<li>
							<button type="button" aria-pressed={book === item.id} onclick={() => (book = item.id)}>{item.name}</button>
							{#if item.canDelete}
								<button type="button" class="link" aria-label="Delete address book {item.name}" onclick={() => ondeletebook(item)}>Delete</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if addingBook}
					<form onsubmit={addBook}>
						<input aria-label="Address book name" placeholder="Name" bind:value={bookName} />
						<button type="submit">Add</button>
						<button type="button" onclick={() => (addingBook = false)}>Cancel</button>
					</form>
				{:else}
					<button type="button" onclick={() => (addingBook = true)}>New address book</button>
				{/if}
			</aside>

			<div class="list">
				{#if shown.length === 0}
					<p class="empty">{query.trim() ? 'No one matches that search.' : 'No contacts yet. Press New contact to add someone.'}</p>
				{:else}
					<ul aria-label="Contacts">
						{#each shown as person (person.id)}
							<li>
								<button type="button" class="row" aria-current={panel.kind === 'detail' && panel.id === person.id ? 'true' : undefined} onclick={() => (panel = { kind: 'detail', id: person.id })}>
									<span class="avatar" aria-hidden="true">{initials(person)}</span>
									<span class="who">
										<strong>{person.displayName}</strong>
										<span class="muted">{person.emails[0] ?? person.organization}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if panel.kind !== 'none' && (panel.kind !== 'detail' || open)}
				<section class="panel" aria-label="Contact">
					{#if panel.kind === 'detail' && open}
						<h2>{open.displayName}</h2>
						{#if open.jobTitle || open.organization}<p class="muted">{[open.jobTitle, open.organization].filter(Boolean).join(', ')}</p>{/if}
						{#if open.emails.length}
							<h3>Email</h3>
							<ul class="facts">
								{#each open.emails as email (email)}<li><a href="/mail/compose?to={encodeURIComponent(email)}" aria-label="Write to {email}">{email}</a></li>{/each}
							</ul>
						{/if}
						{#if open.phones.length}
							<h3>Phone</h3>
							<ul class="facts">
								{#each open.phones as phone (phone)}<li><a href="tel:{phone.replace(/[^+\d]/g, '')}">{phone}</a></li>{/each}
							</ul>
						{/if}
						{#if open.notes}<h3>Notes</h3><p class="body">{open.notes}</p>{/if}
						<div class="actions">
							<button type="button" onclick={() => startEdit(open!)}>Edit</button>
							<button type="button" onclick={() => (panel = { kind: 'confirm-delete', person: open! })}>Delete</button>
							<button type="button" onclick={close}>Close</button>
						</div>
					{:else if panel.kind === 'confirm-delete'}
						{@const person = panel.person}
						<p role="alert">Delete {person.displayName}? This cannot be undone.</p>
						<div class="actions">
							<button type="button" class="danger" onclick={() => remove(person)}>Delete contact</button>
							<button type="button" onclick={close}>Cancel</button>
						</div>
					{:else if panel.kind === 'edit'}
						{@const draft = panel.draft}
						{@const original = panel.original}
						<form class="form" onsubmit={(event) => submit(event, draft, original)}>
							<h2>{original ? 'Edit contact' : 'New contact'}</h2>
							<div class="pair">
								<label><span>First name</span><input bind:value={draft.given} /></label>
								<label><span>Last name</span><input bind:value={draft.surname} /></label>
							</div>
							<fieldset>
								<legend>Email</legend>
								{#each draft.emails as _, index (index)}
									<input type="email" aria-label="Email {index + 1}" bind:value={draft.emails[index]} />
								{/each}
								<button type="button" class="link" onclick={() => draft.emails.push('')}>Add another email</button>
							</fieldset>
							<fieldset>
								<legend>Phone</legend>
								{#each draft.phones as _, index (index)}
									<input type="tel" aria-label="Phone {index + 1}" bind:value={draft.phones[index]} />
								{/each}
								<button type="button" class="link" onclick={() => draft.phones.push('')}>Add another phone</button>
							</fieldset>
							<label><span>Company</span><input bind:value={draft.organization} /></label>
							<label><span>Job title</span><input bind:value={draft.jobTitle} /></label>
							{#if writable.length > 1}
								<label>
									<span>Address book</span>
									<select bind:value={draft.addressBookId}>
										{#each writable as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
									</select>
								</label>
							{/if}
							<label><span>Notes</span><textarea rows="3" bind:value={draft.notes}></textarea></label>
							{#if formError}<p class="problem" role="alert">{formError}</p>{/if}
							<div class="actions">
								<button type="submit" class="primary">Save contact</button>
								<button type="button" onclick={close}>Cancel</button>
							</div>
						</form>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</section>

<style>
	.people {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-2);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		min-width: 0;
	}
	h1, h2, h3, p, ul { margin: 0; }
	h1 { color: var(--color-brand); }
	h2 { font-size: 1.125rem; }
	h3 { font-size: 0.875rem; color: var(--color-muted); }
	ul { padding: 0; list-style: none; }
	.top, .tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	.top { justify-content: space-between; }
	button, input, select, textarea {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
	}
	textarea { padding-block: 0.5rem; resize: vertical; }
	button { cursor: pointer; }
	button.primary, button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	button.link { border: 0; background: none; padding: 0; text-decoration: underline; color: var(--color-muted); }
	.problem { font-weight: 600; }
	.muted, .empty { color: var(--color-muted); }
	.layout { display: grid; grid-template-columns: minmax(11rem, 14rem) minmax(0, 1fr) auto; gap: var(--space-2); align-items: start; }
	aside { display: grid; gap: var(--space-2); }
	aside ul { display: grid; gap: 0.25rem; }
	aside li { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	aside li > button:first-child { flex: 1; text-align: start; overflow-wrap: anywhere; }
	aside form { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	aside form input { width: 100%; }
	.list ul { display: grid; gap: 0.125rem; }
	.row { width: 100%; display: flex; align-items: center; gap: 0.75rem; text-align: start; padding-block: 0.375rem; border-color: transparent; }
	.row[aria-current='true'] { border-color: var(--color-accent); }
	.avatar { flex: none; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 999px; background: var(--color-border); font-size: 0.8125rem; font-weight: 600; }
	.who { display: grid; min-width: 0; overflow-wrap: anywhere; }
	.panel { width: min(100%, 22rem); display: grid; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); }
	.facts { display: grid; gap: 0.25rem; overflow-wrap: anywhere; }
	.body { white-space: pre-wrap; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.form { display: grid; gap: 0.75rem; }
	.form label, fieldset { display: grid; gap: 0.25rem; }
	.form label span, legend { font-size: 0.875rem; color: var(--color-muted); }
	fieldset { border: 0; padding: 0; margin: 0; justify-items: start; }
	.form input, .form select, .form textarea { width: 100%; box-sizing: border-box; }
	.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (max-width: 64rem) {
		.layout { grid-template-columns: minmax(0, 1fr); }
		.panel { width: auto; }
	}
</style>
