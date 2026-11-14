<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		checkFor,
		connectionSettings,
		stateLabel,
		formatBytes,
		parseZone,
		passwordProblem,
		remaining,
		validLocalPart,
		type DnsCheck,
		type DomainView,
		type Mailbox
	} from '$lib/panel/model';

	type Props = {
		logo?: Snippet;
		view: DomainView;
		mailboxes: Mailbox[];
		checks: DnsCheck[] | null;
		onrecheck: () => Promise<void>;
		oncatchall: (mailbox: string) => Promise<void>;
		onclose: () => Promise<void>;
		oncreate: (name: string, password: string) => Promise<void>;
		ondelete: (mailbox: Mailbox) => Promise<void>;
		onpassword: (mailbox: Mailbox, password: string) => Promise<void>;
		onaddalias: (mailbox: Mailbox, alias: string) => Promise<void>;
		onremovealias: (mailbox: Mailbox, alias: string) => Promise<void>;
	};

	let { logo, view, mailboxes, checks, onrecheck, oncatchall, onclose, oncreate, ondelete, onpassword, onaddalias, onremovealias }: Props = $props();
	const published = $derived(checks ? checks.filter((check) => check.state === 'found').length : 0);

	const rows = $derived(parseZone(view.dnsZone, view.domain));
	const required = $derived(rows.filter((row) => row.required));
	const optional = $derived(rows.filter((row) => !row.required));
	const mailboxesLeft = $derived(remaining(view.plan.mailboxes, view.usage.mailboxes));
	const aliasesLeft = $derived(remaining(view.plan.aliases, view.usage.aliases));

	let catchAll = $state('');
	// Follows the server's value whenever the page reloads the domain.
	$effect(() => {
		catchAll = view.catchAll ? view.catchAll.split('@')[0] : '';
	});
	let closing = $state('');
	let newName = $state('');
	let newPassword = $state('');
	let message = $state('');
	let messageKind = $state<'error' | 'success'>('success');
	let busy = $state('');
	let editing = $state<{ id: string; kind: 'password' | 'alias'; value: string } | null>(null);
	let copied = $state('');

	function say(kind: 'error' | 'success', text: string) {
		messageKind = kind;
		message = text;
	}

	async function run(key: string, task: () => Promise<void>, success: string) {
		busy = key;
		message = '';
		try {
			await task();
			say('success', success);
			return true;
		} catch (err) {
			say('error', err instanceof Error ? err.message : 'Something went wrong.');
			return false;
		} finally {
			busy = '';
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!validLocalPart(newName)) return say('error', 'Use letters, digits, dots, dashes or underscores for the address.');
		const weak = passwordProblem(newPassword);
		if (weak) return say('error', weak);
		const email = `${newName.trim().toLowerCase()}@${view.domain}`;
		if (await run('create', () => oncreate(newName.trim(), newPassword), `${email} was created.`)) {
			newName = '';
			newPassword = '';
		}
	}

	async function submitEdit(event: SubmitEvent, mailbox: Mailbox) {
		event.preventDefault();
		if (!editing) return;
		const { kind, value } = editing;
		if (kind === 'password') {
			const weak = passwordProblem(value);
			if (weak) return say('error', weak);
			if (await run(mailbox.id, () => onpassword(mailbox, value), `The password for ${mailbox.email} was changed.`)) editing = null;
		} else {
			if (!validLocalPart(value)) return say('error', 'Use letters, digits, dots, dashes or underscores for the alias.');
			const alias = `${value.trim().toLowerCase()}@${view.domain}`;
			if (await run(mailbox.id, () => onaddalias(mailbox, value.trim()), `${alias} now delivers to ${mailbox.email}.`)) editing = null;
		}
	}

	async function remove(mailbox: Mailbox) {
		if (!confirm(`Delete ${mailbox.email} and all of its mail? This cannot be undone.`)) return;
		await run(mailbox.id, () => ondelete(mailbox), `${mailbox.email} was deleted.`);
	}

	async function copy(key: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = key;
			setTimeout(() => (copied = ''), 1500);
		} catch {
			copied = '';
		}
	}
</script>

<section class="manage" aria-labelledby="manage-title">
	<header>
		<h1 id="manage-title">{view.domain}</h1>
		<p class="muted">Free plan</p>
	</header>

	<ul class="usage" aria-label="Plan usage">
		<li>
			<span class="label">Mailboxes</span>
			<meter min="0" max={view.plan.mailboxes} value={view.usage.mailboxes} aria-label="Mailboxes used"></meter>
			<span>{view.usage.mailboxes} of {view.plan.mailboxes}</span>
		</li>
		<li>
			<span class="label">Aliases</span>
			<meter min="0" max={Math.max(1, view.plan.aliases)} value={view.usage.aliases} aria-label="Aliases used"></meter>
			<span>{view.usage.aliases} of {view.plan.aliases}</span>
		</li>
		<li>
			<span class="label">Storage</span>
			<span>{formatBytes(view.plan.mailboxMb * 1024 * 1024)} per mailbox</span>
		</li>
	</ul>

	{#if message}
		<p class="alert" data-kind={messageKind} role={messageKind === 'error' ? 'alert' : 'status'}>{message}</p>
	{/if}

	{#if logo}
		<section aria-labelledby="logo-title">
			<h2 id="logo-title">Logo and sign-in</h2>
			{@render logo()}
		</section>
	{/if}

	<section aria-labelledby="mailboxes-title">
		<h2 id="mailboxes-title">Mailboxes</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th scope="col">Address</th><th scope="col">Aliases</th><th scope="col">Storage</th><th scope="col"><span class="sr-only">Actions</span></th></tr>
				</thead>
				<tbody>
					{#each mailboxes as mailbox (mailbox.id)}
						<tr>
							<th scope="row">
								{mailbox.email}
								{#if mailbox.owner}<span class="tag">owner</span>{/if}
							</th>
							<td>
								{#if mailbox.aliases.length === 0}<span class="muted">None</span>{/if}
								<ul class="chips">
									{#each mailbox.aliases as alias (alias)}
										<li>
											{alias}@{view.domain}
											<button type="button" class="chip-x" aria-label="Remove alias {alias}@{view.domain}" disabled={busy === mailbox.id} onclick={() => run(mailbox.id, () => onremovealias(mailbox, alias), `${alias}@${view.domain} was removed.`)}>×</button>
										</li>
									{/each}
								</ul>
							</td>
							<td>{formatBytes(mailbox.usedBytes)} of {formatBytes(mailbox.quotaBytes)}</td>
							<td class="actions">
								<button type="button" class="secondary" disabled={busy === mailbox.id || aliasesLeft === 0} title={aliasesLeft === 0 ? 'Alias limit reached' : undefined} onclick={() => (editing = { id: mailbox.id, kind: 'alias', value: '' })}>Add alias</button>
								<button type="button" class="secondary" disabled={busy === mailbox.id} onclick={() => (editing = { id: mailbox.id, kind: 'password', value: '' })}>Password</button>
								{#if !mailbox.owner && !mailbox.you}
									<button type="button" class="danger" disabled={busy === mailbox.id} onclick={() => remove(mailbox)}>Delete</button>
								{/if}
							</td>
						</tr>
						{#if editing?.id === mailbox.id}
							<tr class="edit">
								<td colspan="4">
									<form onsubmit={(event) => submitEdit(event, mailbox)}>
										{#if editing.kind === 'password'}
											<label for="edit-{mailbox.id}">New password for {mailbox.email}</label>
											<input id="edit-{mailbox.id}" type="password" autocomplete="new-password" bind:value={editing.value} />
										{:else}
											<label for="edit-{mailbox.id}">New alias for {mailbox.email}</label>
											<span class="address"><input id="edit-{mailbox.id}" autocapitalize="off" spellcheck="false" bind:value={editing.value} /><span>@{view.domain}</span></span>
										{/if}
										<button type="submit" disabled={busy === mailbox.id}>Save</button>
										<button type="button" class="secondary" onclick={() => (editing = null)}>Cancel</button>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		{#if mailboxesLeft > 0}
			<form class="add" onsubmit={create} novalidate>
				<h3>Add a mailbox</h3>
				<label for="new-name">Address</label>
				<span class="address"><input id="new-name" bind:value={newName} autocapitalize="off" spellcheck="false" autocomplete="off" /><span>@{view.domain}</span></span>
				<label for="new-password">Password</label>
				<input id="new-password" type="password" bind:value={newPassword} autocomplete="new-password" />
				<button type="submit" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create mailbox'}</button>
			</form>
		{:else}
			<p class="muted">You are using all {view.plan.mailboxes} mailboxes on the free plan.</p>
		{/if}
	</section>

	<section aria-labelledby="catchall-title">
		<h2 id="catchall-title">Catch-all</h2>
		<p class="muted">Mail sent to an address that does not exist at {view.domain} is normally bounced. A catch-all delivers it to one mailbox instead, which also collects more spam.</p>
		<form class="catchall" onsubmit={(event) => { event.preventDefault(); void run('catchall', () => oncatchall(catchAll), catchAll ? `Unknown addresses now deliver to ${catchAll}@${view.domain}.` : 'Catch-all is off.'); }}>
			<label for="catchall">Deliver unknown addresses to</label>
			<select id="catchall" bind:value={catchAll}>
				<option value="">Nobody (bounce them)</option>
				{#each mailboxes as mailbox (mailbox.id)}
					<option value={mailbox.name}>{mailbox.email}</option>
				{/each}
			</select>
			<button type="submit" class="secondary" disabled={busy === 'catchall'}>Save</button>
		</form>
	</section>

	<section aria-labelledby="dns-title">
		<h2 id="dns-title">DNS records</h2>
		<p class="muted">Publish these at your DNS provider so {view.domain} can send and receive mail through {view.mailHost}.</p>
		<p class="dns-summary">
			{#if checks}
				{published} of {checks.length} required records are published.
			{:else}
				Checking DNS…
			{/if}
			<button type="button" class="secondary" disabled={busy === 'dns'} onclick={() => run('dns', onrecheck, 'DNS checked again. Changes can take up to an hour to appear.')}>Check again</button>
		</p>
		<div class="table-wrap">
			<table>
				<thead><tr><th scope="col">Status</th><th scope="col">Type</th><th scope="col">Host</th><th scope="col">Value</th><th scope="col">Purpose</th></tr></thead>
				<tbody>
					{#each required as row, index (index)}
						{@const check = checks ? checkFor(row, checks) : undefined}
						<tr>
							<td class="status" data-state={check?.state ?? 'unknown'}>
								{stateLabel(check)}
								{#if check?.state === 'different' && check.actual}<span class="actual">Found: <code>{check.actual}</code></span>{/if}
							</td>
							<td><code>{row.type}</code></td>
							<td><code>{row.host}</code></td>
							<td class="value"><code>{row.value}</code> <button type="button" class="link" onclick={() => copy(`r${index}`, row.value)}>{copied === `r${index}` ? 'Copied' : 'Copy'}</button></td>
							<td>{row.purpose}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if optional.length > 0}
			<details>
				<summary>Optional records ({optional.length})</summary>
				<div class="table-wrap">
					<table>
						<tbody>
							{#each optional as row, index (index)}
								<tr>
									<td><code>{row.type}</code></td>
									<td><code>{row.host}</code></td>
									<td class="value"><code>{row.value}</code></td>
									<td>{row.purpose}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{/if}
	</section>

	<section aria-labelledby="close-title" class="danger-zone">
		<h2 id="close-title">Close this domain</h2>
		<p>This deletes every mailbox at {view.domain}, all of their mail, and the domain itself. It cannot be undone.</p>
		<p class="muted">To keep your mail, first download it with any mail app (IMAP settings below), which copies every folder to your computer.</p>
		<form onsubmit={(event) => { event.preventDefault(); if (closing.trim().toLowerCase() !== view.domain) { say('error', `Type ${view.domain} to confirm.`); return; } void run('close', onclose, ''); }}>
			<label for="close-confirm">Type {view.domain} to confirm</label>
			<input id="close-confirm" bind:value={closing} autocomplete="off" autocapitalize="off" spellcheck="false" />
			<button type="submit" class="danger" disabled={busy === 'close'}>{busy === 'close' ? 'Closing…' : 'Close domain and delete all mail'}</button>
		</form>
	</section>

	<section aria-labelledby="apps-title">
		<h2 id="apps-title">Mail apps</h2>
		<p><a href="/mail">Open webmail</a> or use any mail app with these settings.</p>
		<dl class="settings">
			{#each connectionSettings(view.mailHost) as item (item.label)}
				<dt>{item.label}</dt>
				<dd>{item.value}</dd>
			{/each}
		</dl>
	</section>
</section>

<style>
	.manage { display: grid; gap: var(--space-4); max-inline-size: 72rem; margin-inline: auto; padding: var(--space-3); }
	header h1 { margin: 0; overflow-wrap: anywhere; }
	h2 { margin: 0 0 var(--space-2); }
	h3 { margin: 0; font-size: 1.05em; }
	.muted { color: var(--color-muted); margin: 0; }
	.usage { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-3); }
	.usage li { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.usage .label { font-weight: 600; }
	meter { inline-size: 6rem; }
	.alert { margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-inline-start: 3px solid var(--green, #16a34a); border-radius: var(--radius); background: var(--color-card); }
	.alert[data-kind='error'] { border-inline-start-color: var(--color-danger); }
	.table-wrap { overflow-x: auto; }
	table { inline-size: 100%; border-collapse: collapse; }
	th, td { text-align: start; vertical-align: top; padding: var(--space-2); border-block-start: 1px solid var(--color-border); }
	thead th { border-block-start: 0; color: var(--color-muted); font-weight: 600; }
	th[scope='row'] { font-weight: 600; overflow-wrap: anywhere; }
	td.value { overflow-wrap: anywhere; max-inline-size: 32rem; }
	.tag { margin-inline-start: var(--space-1); font-size: 0.8em; font-weight: 500; padding: 0 var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius); color: var(--color-muted); }
	.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-1); }
	.chips li { display: inline-flex; align-items: center; gap: 2px; padding: 0 var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius); }
	.chip-x { min-height: 1.75rem; min-inline-size: 1.75rem; padding: 0; background: transparent; color: var(--color-text); border: 0; }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-1); justify-content: flex-end; }
	tr.edit td { background: var(--color-card); }
	tr.edit form { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	form.add { display: grid; gap: var(--space-2); max-inline-size: 28rem; margin-block-start: var(--space-3); }
	label { font-weight: 600; }
	input { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); min-inline-size: 0; }
	.address { display: inline-flex; align-items: center; gap: var(--space-1); }
	.address input { flex: 1; }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-3); border-radius: var(--radius); border: 1px solid transparent; background: var(--color-accent); color: var(--color-accent-fg); cursor: pointer; justify-self: start; }
	button.secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
	button.danger { background: transparent; color: var(--color-danger); border-color: var(--color-danger); }
	button.link { min-height: auto; padding: 0 var(--space-1); background: transparent; color: var(--color-text); text-decoration: underline; border: 0; }
	button:disabled { opacity: 0.6; cursor: not-allowed; }
	.danger-zone { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-danger); border-radius: var(--radius); }
	.danger-zone h2, .danger-zone p { margin: 0; }
	.danger-zone form { display: grid; gap: var(--space-2); max-inline-size: 28rem; }
	form.catchall { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
	select { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	.settings { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); margin: 0; }
	.settings dt { color: var(--color-muted); }
	.settings dd { margin: 0; }
	.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	details summary { cursor: pointer; margin-block-start: var(--space-2); }
	.dns-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
	td.status { font-weight: 600; white-space: nowrap; color: var(--color-text); }
	td.status::before { content: ''; display: inline-block; inline-size: 0.6rem; block-size: 0.6rem; border-radius: 50%; margin-inline-end: var(--space-1); background: var(--color-border); }
	td.status[data-state='found']::before { background: var(--green, #16a34a); }
	td.status[data-state='missing']::before, td.status[data-state='different']::before { background: var(--color-danger); }
	td.status .actual { display: block; font-weight: 400; color: var(--color-muted); white-space: normal; overflow-wrap: anywhere; max-inline-size: 18rem; }
</style>
