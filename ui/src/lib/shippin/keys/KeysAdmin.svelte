<script lang="ts">
	import { onMount } from 'svelte';
	import { onAction, pause, spotlight, until } from '../agent/agent.svelte';
	import {
		SERVICES,
		emptyDraft,
		keyText,
		missingServices,
		newKeyProblem,
		type KeysReport,
		type NewKeyDraft,
		type ServiceName
	} from './keys-admin-call';

	let {
		report,
		notice,
		problem,
		result,
		onauthor,
		onreplace
	}: {
		report: KeysReport | null;
		notice: string;
		problem: string;
		result: string;
		onauthor: () => Promise<void>;
		onreplace: (service: ServiceName, draft: NewKeyDraft) => Promise<void>;
	} = $props();

	// One form per service, made before anything renders: state cannot change during render.
	let drafts = $state<Record<ServiceName, NewKeyDraft>>({
		ai: emptyDraft(),
		sso: emptyDraft(),
		google: emptyDraft(),
		'domain-proof': emptyDraft()
	});
	let local = $state<Record<string, string>>({});
	let busy = $state(false);
	const missing = $derived(report ? missingServices(report) : []);

	async function run(work: () => Promise<void>) {
		busy = true;
		try {
			await work();
		} finally {
			busy = false;
		}
	}

	function serviceOf(value: unknown): ServiceName {
		if (typeof value === 'string' && value in SERVICES) return value as ServiceName;
		throw new Error('Name a service: ai, sso, google or domain-proof.');
	}

	// What an agent can do here (component.json "actions"), on this screen, in view.
	onMount(() => {
		const unbind = [
			onAction('keys.list', async () => {
				await until(() => report !== null, 'The Keys page');
				if (!report) throw new Error('The keys have not loaded yet.');
				spotlight(document.getElementById('keys-title'));
				const lines = report.services.map((item) => `${SERVICES[item.service].name}: ${item.keys.map(keyText).join(' ') || 'no key yet.'}`);
				return { text: lines.join('\n'), data: report };
			}),
			onAction(
				'keys.author',
				async () => {
					await run(onauthor);
					if (problem) throw new Error(problem);
					return { text: result || 'Every service already had its key.' };
				},
				async () => {
					spotlight(document.getElementById('author-title') ?? document.getElementById('keys-title'));
					await pause();
				}
			),
			onAction(
				'keys.replace',
				async (args) => {
					const service = serviceOf(args.service);
					await run(() => onreplace(service, drafts[service]));
					drafts[service] = emptyDraft();
					if (problem) throw new Error(problem);
					return { text: result };
				},
				async (args) => {
					await until(() => report !== null, 'The Keys page');
					const service = serviceOf(args.service);
					const from = args.from ?? 'random';
					if (from !== 'random' && from !== 'environmentVariable' && from !== 'file') {
						throw new Error('An agent can make a key at random, or point to a variable or a file. A key to paste, the operator pastes themselves.');
					}
					drafts[service] = { from, value: '', name: String(args.name ?? ''), path: String(args.path ?? '') };
					spotlight(document.getElementById(`service-${service}`)?.closest('section') ?? null);
					await pause(900);
					local[service] = newKeyProblem(drafts[service]);
					if (local[service]) throw new Error(local[service]);
				}
			)
		];
		return () => unbind.forEach((off) => off());
	});

	async function replace(event: SubmitEvent, service: ServiceName) {
		event.preventDefault();
		const draft = drafts[service];
		local[service] = newKeyProblem(draft);
		if (local[service]) return;
		await run(() => onreplace(service, draft));
		drafts[service] = emptyDraft();
	}
</script>

<section class="keys-admin" aria-labelledby="keys-title">
	<h1 id="keys-title">Keys</h1>
	<p>
		One key, one job. Each service below has its own key and uses it for nothing else. The install key only let the
		first administrator in. The key-wrapping key only wraps the service keys, and is kept outside the database.
	</p>
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#if result}<p role="status">{result}</p>{/if}

	{#if report}
		<section aria-labelledby="wrapping-title" class="card">
			<h2 id="wrapping-title">Key-wrapping key</h2>
			<p>
				{report.wrapping.madeHere ? 'Made at random by this server' : 'Given to this server by you'}, in the file
				<code>{report.wrapping.path}</code>.
				{report.wrapping.readable ? 'The server can read it.' : 'The server cannot read it: no stored key opens until it can.'}
			</p>
			<p class="muted">Backups leave it out on purpose. Keep one copy apart from them: a new server needs it to read saved secrets.</p>
		</section>

		{#if missing.length}
			<section aria-labelledby="author-title" class="card">
				<h2 id="author-title">Author your keys</h2>
				<p>
					{missing.length === 1 ? 'One service has' : `${missing.length} services have`} no key yet:
					{missing.map((service) => SERVICES[service].name).join(', ')}. Make them now at random, or replace any of them
					below with your own.
				</p>
				<button type="button" class="primary" disabled={busy} onclick={() => run(onauthor)}>Make the missing keys</button>
			</section>
		{/if}

		{#each report.services as item (item.service)}
			<section aria-labelledby="service-{item.service}" class="card">
				<h2 id="service-{item.service}">{SERVICES[item.service].name}</h2>
				<p class="muted">{SERVICES[item.service].job}</p>
				{#if item.keys.length}
					<ul>
						{#each item.keys as key (key.id)}<li>{keyText(key)}</li>{/each}
					</ul>
				{:else}
					<p>No key yet. One is made at random the first time this service needs it.</p>
				{/if}
				<form onsubmit={(event) => replace(event, item.service)} aria-label="New key for {SERVICES[item.service].name}" novalidate>
					<fieldset>
						<legend>Where the new key comes from</legend>
						<label class="check"><input type="radio" bind:group={drafts[item.service].from} value="random" /> Made at random by this server</label>
						<label class="check"><input type="radio" bind:group={drafts[item.service].from} value="value" /> Paste my own</label>
						<label class="check"><input type="radio" bind:group={drafts[item.service].from} value="environmentVariable" /> An environment variable</label>
						<label class="check"><input type="radio" bind:group={drafts[item.service].from} value="file" /> A file on the server</label>
					</fieldset>
					{#if drafts[item.service].from === 'value'}
						<label>
							<span>Your key (32 bytes as base64)</span>
							<input bind:value={drafts[item.service].value} type="password" autocomplete="off" spellcheck="false" />
						</label>
						<p class="muted">It is stored wrapped by the key-wrapping key and never shown again.</p>
					{:else if drafts[item.service].from === 'environmentVariable'}
						<label><span>Variable name</span><input bind:value={drafts[item.service].name} autocomplete="off" spellcheck="false" /></label>
						<p class="muted">The variable holds 32 bytes as base64. The key is read from it and never stored.</p>
					{:else if drafts[item.service].from === 'file'}
						<label><span>File path</span><input bind:value={drafts[item.service].path} autocomplete="off" spellcheck="false" placeholder="/run/secrets/key" /></label>
						<p class="muted">The file holds 32 bytes as base64. The key is read from it and never stored.</p>
					{/if}
					{#if local[item.service]}<p class="problem" role="alert">{local[item.service]}</p>{/if}
					<button type="submit" disabled={busy}>Replace the key<span class="sr"> for {SERVICES[item.service].name}</span></button>
				</form>
			</section>
		{/each}
	{/if}
</section>

<style>
	.keys-admin {
		display: grid;
		gap: var(--space-3);
		max-width: 56rem;
	}
	.card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
	}
	h2 {
		font-size: 1.1rem;
		margin: 0;
	}
	p,
	ul {
		margin: 0;
	}
	form {
		display: grid;
		gap: var(--space-2);
	}
	fieldset {
		display: grid;
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-2);
	}
	label {
		display: grid;
		gap: var(--space-1);
	}
	label.check {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.muted {
		color: var(--color-muted);
	}
	.problem {
		color: var(--color-danger);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	button {
		justify-self: start;
	}
</style>
