<script lang="ts">
	import { onMount } from 'svelte';
	import KeyNotice from '$lib/shippin/keys/KeyNotice.svelte';
	import { onAction, pause, spotlight, until } from '../agent/agent.svelte';
	import { aiProblem, endpointHint, type AiDraft, type AiSettings } from './assistant-call';

	let {
		saved,
		notice,
		problem,
		result,
		onsave,
		ontest,
		onclear
	}: {
		saved: AiSettings | null;
		notice: string;
		problem: string;
		result: string;
		onsave: (draft: AiDraft) => Promise<void>;
		ontest: () => Promise<void>;
		onclear: () => Promise<void>;
	} = $props();

	let draft = $state<AiDraft>({ kind: 'openai', endpoint: '', model: '', key: '', assistant: false });
	let local = $state('');
	let busy = $state(false);

	// Follows the server whenever the saved settings change.
	$effect(() => {
		if (saved) draft = { kind: saved.kind ?? 'openai', endpoint: saved.endpoint ?? '', model: saved.model ?? '', key: '', assistant: saved.assistant };
	});

	async function run(action: () => Promise<void>) {
		busy = true;
		await action();
		busy = false;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		local = aiProblem(draft);
		if (!local) void run(() => onsave(draft));
	}

	// What an agent can do here (component.json "actions"). It never handles the key: if the
	// service needs one, the operator pastes it into the Key field themselves.
	onMount(() => {
		const unbind = [
			onAction(
				'ai.settings.save',
				async () => {
					await run(() => onsave(draft));
					if (problem) throw new Error(problem);
					return { text: result || 'Saved.', data: { kind: draft.kind, endpoint: draft.endpoint, model: draft.model, assistant: draft.assistant } };
				},
				async (args) => {
					await until(() => saved !== null || (notice !== '' && notice !== 'Loading.'), 'The AI settings');
					if (!saved) throw new Error(notice || 'The AI settings could not be loaded.');
					draft = {
						kind: args.kind === 'anthropic' ? 'anthropic' : 'openai',
						endpoint: String(args.endpoint ?? ''),
						model: String(args.model ?? ''),
						key: '',
						assistant: args.assistant === true
					};
					spotlight(document.querySelector('form[aria-label="AI settings"]'));
					await pause(900);
					local = aiProblem(draft);
					if (local) throw new Error(local);
				}
			),
			onAction('ai.connection.test', async () => {
				await until(() => saved !== null || (notice !== '' && notice !== 'Loading.'), 'The AI settings');
				if (!saved?.model) throw new Error('Save the settings first.');
				spotlight(document.querySelector('form[aria-label="AI settings"]'));
				await run(ontest);
				if (problem) throw new Error(problem);
				return { text: result };
			})
		];
		return () => unbind.forEach((off) => off());
	});
</script>

<section class="ai" aria-labelledby="ai-title">
	<header>
		<h1 id="ai-title">AI settings</h1>
		<p class="muted">Off until you set it. Point it at a model on your own machines to keep everything here, or at a service you choose.</p>
	</header>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#if result}<p role="status">{result}</p>{/if}

	<form onsubmit={submit} aria-label="AI settings" novalidate>
		<label>
			<span>Kind of service</span>
			<select bind:value={draft.kind}>
				<option value="openai">OpenAI-compatible, including Ollama</option>
				<option value="anthropic">Anthropic</option>
			</select>
		</label>
		<label>
			<span>Address</span>
			<input bind:value={draft.endpoint} type="url" placeholder={endpointHint(draft.kind)} autocomplete="off" spellcheck="false" />
		</label>
		<label><span>Model name</span><input bind:value={draft.model} autocomplete="off" spellcheck="false" /></label>
		<label>
			<span>Key{saved?.hasKey ? ' (leave empty to keep it)' : ' (if it needs one)'}</span>
			<input bind:value={draft.key} type="password" autocomplete="new-password" />
		</label>
		<KeyNotice variant="ai" detailsOpen={!saved?.hasKey} />
		<label class="check"><input type="checkbox" bind:checked={draft.assistant} /> Offer the assistant to people on this server</label>
		<p class="muted">People's questions go to this service. Their mail does not.</p>
		{#if local}<p class="problem" role="alert">{local}</p>{/if}
		<div class="row">
			<button type="submit" class="primary" disabled={busy}>Save settings</button>
			{#if saved?.model}
				<button type="button" disabled={busy} onclick={() => run(ontest)}>Test the connection</button>
				<button type="button" disabled={busy} onclick={() => run(onclear)}>Remove these settings</button>
			{/if}
		</div>
	</form>
</section>

<style>
	.ai { display: grid; gap: var(--y-s); min-width: 0; }
	h1, p { margin: 0; }
	form { display: grid; gap: 0.75rem; max-width: 36rem; padding: var(--y-s) var(--x-s); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	label:not(.check) { display: grid; gap: 0.25rem; }
	label > span { font-size: 0.875rem; color: var(--color-muted); }
	input:not([type='checkbox']), select { width: 100%; }
	input:not([type='checkbox']), select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	.check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; }
	.check input { width: 1.25rem; height: 1.25rem; }
	.row { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
</style>
