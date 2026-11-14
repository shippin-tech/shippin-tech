<script lang="ts">
	import { templateLabel, templateProblem, templateVariables, type CalendarTemplate } from '$lib/shippin/calendar-templates/calendar-templates-call';

	let {
		templates,
		notice,
		problem,
		result,
		onsave,
		onreset
	}: {
		templates: CalendarTemplate[];
		notice: string;
		problem: string;
		result: string;
		onsave: (id: string, source: string) => Promise<void>;
		onreset: (id: string) => Promise<void>;
	} = $props();

	let selected = $state<CalendarTemplate['id']>('invite');
	let text = $state('');
	let local = $state('');
	let busy = $state(false);

	const current = $derived(templates.find((item) => item.id === selected));
	const variables = $derived(current ? templateVariables(current.builtIn) : []);

	// Follows the server, and the chosen email, whenever either changes.
	$effect(() => {
		text = current ? (current.custom ?? current.builtIn) : '';
		local = '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		local = templateProblem(text);
		if (local || !current) return;
		busy = true;
		await onsave(current.id, text);
		busy = false;
	}

	async function reset() {
		if (!current) return;
		busy = true;
		await onreset(current.id);
		busy = false;
	}
</script>

<section class="templates" aria-labelledby="templates-title">
	<header>
		<h1 id="templates-title">Calendar emails</h1>
		<p class="muted">Reword the emails people get about events. Leave a placeholder out and that detail disappears from the email.</p>
	</header>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#if result}<p role="status">{result}</p>{/if}

	{#if current}
		<div class="tabs" role="group" aria-label="Which email">
			{#each templates as item (item.id)}
				<button type="button" aria-pressed={selected === item.id} onclick={() => (selected = item.id)}>{templateLabel(item.id)}</button>
			{/each}
		</div>
		<p class="muted">{current.custom === null ? 'Using the built-in email.' : 'Using your email.'}</p>
		<form onsubmit={submit} novalidate>
			<label>
				<span>HTML of the {templateLabel(current.id).toLowerCase()}</span>
				<textarea bind:value={text} rows="18" spellcheck="false" autocomplete="off"></textarea>
			</label>
			{#if local}<p class="problem" role="alert">{local}</p>{/if}
			<div class="tabs">
				<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving' : 'Save email'}</button>
				{#if current.custom !== null}<button type="button" disabled={busy} onclick={reset}>Go back to the built-in email</button>{/if}
			</div>
		</form>
		<section aria-labelledby="variables-title">
			<h2 id="variables-title">Placeholders you can use</h2>
			<ul>
				{#each variables as name (name)}<li><code>{`{{${name}}}`}</code></li>{/each}
			</ul>
		</section>
	{/if}
</section>

<style>
	.templates, section, form { display: grid; gap: var(--y-2xs); min-width: 0; }
	.templates { gap: var(--y-s); }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1.125rem; }
	ul { padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	.tabs { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	label { display: grid; gap: 0.25rem; }
	label span { font-size: 0.875rem; color: var(--color-muted); }
	textarea { font-family: ui-monospace, monospace; font-size: 0.875rem; width: 100%; padding: var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary, button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
</style>
