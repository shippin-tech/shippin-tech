<script lang="ts">
	import {
		alertCondition,
		alertDestinations,
		alertProblem,
		alertStatus,
		draftFromAlert,
		emptyAlertDraft,
		type AlertDraft,
		type AlertMetric,
		type AlertRule
	} from '$lib/shippin/alerts/alerts-call';

	let {
		rules,
		metrics,
		notice,
		problem,
		result,
		onsave,
		ontoggle,
		onremove,
		oncheck
	}: {
		rules: AlertRule[];
		metrics: AlertMetric[];
		notice: string;
		problem: string;
		result: string;
		onsave: (draft: AlertDraft) => Promise<boolean>;
		ontoggle: (rule: AlertRule, enabled: boolean) => void;
		onremove: (rule: AlertRule) => void;
		oncheck: () => void;
	} = $props();

	let draft = $state<AlertDraft | null>(null);
	let draftProblem = $state('');
	let saving = $state(false);
	let confirming = $state('');

	const chosen = $derived(metrics.find((metric) => metric.name === draft?.metric));

	function start(next: AlertDraft) {
		draft = next;
		draftProblem = '';
		confirming = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!draft) return;
		draftProblem = alertProblem(draft, metrics);
		if (draftProblem) return;
		saving = true;
		const saved = await onsave(draft);
		saving = false;
		if (saved) draft = null;
	}
</script>

<section class="alerts" aria-labelledby="alerts-title">
	<header>
		<h1 id="alerts-title">Alerts</h1>
		<p class="muted">Get an email or a webhook call when a number on this server crosses a line you set. Alerts are checked every five minutes.</p>
	</header>

	<div class="tools">
		<button type="button" class="primary" onclick={() => start(emptyAlertDraft())}>New alert</button>
		<button type="button" onclick={oncheck} disabled={rules.length === 0}>Check now</button>
	</div>

	{#if notice}<p role="status">{notice}</p>{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#if result}<p role="status">{result}</p>{/if}

	{#if draft}
		<form class="form" onsubmit={submit} aria-label={draft.id ? 'Edit alert' : 'New alert'} novalidate>
			<label><span>Name</span><input bind:value={draft.name} maxlength="120" autocomplete="off" /></label>
			<label>
				<span>Metric</span>
				<input bind:value={draft.metric} list="alert-metrics" autocomplete="off" spellcheck="false" />
				<datalist id="alert-metrics">
					{#each metrics as metric (metric.name)}<option value={metric.name}>{metric.description}</option>{/each}
				</datalist>
				{#if chosen}<small class="muted">{chosen.description}</small>{/if}
			</label>
			<div class="row">
				<label>
					<span>Send when it is</span>
					<select
						value={draft.above ? 'above' : 'below'}
						onchange={(event) => {
							if (draft) draft.above = event.currentTarget.value === 'above';
						}}
					>
						<option value="above">Above</option>
						<option value="below">Below</option>
					</select>
				</label>
				<label><span>Threshold</span><input bind:value={draft.threshold} inputmode="decimal" autocomplete="off" /></label>
				<label>
					<span>Over</span>
					<select bind:value={draft.window}>
						<option value="1h">The last hour</option>
						<option value="24h">The last day</option>
					</select>
				</label>
			</div>
			<label>
				<span>Email to</span>
				<input bind:value={draft.email} autocomplete="off" spellcheck="false" />
				<small class="muted">Separate addresses with commas.</small>
			</label>
			<label><span>Webhook address</span><input bind:value={draft.webhook} type="url" autocomplete="off" spellcheck="false" /></label>
			<label>
				<span>Minutes before alerting again</span>
				<input bind:value={draft.cooldownMinutes} inputmode="numeric" autocomplete="off" />
			</label>
			<label class="check"><input type="checkbox" bind:checked={draft.enabled} /> Turned on</label>
			{#if draftProblem}<p class="problem" role="alert">{draftProblem}</p>{/if}
			<div class="tools">
				<button type="submit" class="primary" disabled={saving}>{saving ? 'Saving' : 'Save alert'}</button>
				<button type="button" onclick={() => (draft = null)}>Cancel</button>
			</div>
		</form>
	{/if}

	{#if rules.length === 0 && !notice}
		<p class="muted">No alerts yet. Start with failed sign-ins or the size of the mail queue.</p>
	{:else}
		<ul class="rules" aria-label="Your alerts">
			{#each rules as rule (rule.id)}
				<li>
					<div class="what">
						<h2>{rule.name}</h2>
						<p>{alertCondition(rule)}</p>
						<p class="muted">Sends to {alertDestinations(rule)}</p>
						<p class="muted">{alertStatus(rule)}</p>
					</div>
					<div class="actions">
						<label class="check">
							<input type="checkbox" checked={rule.enabled} onchange={(event) => ontoggle(rule, event.currentTarget.checked)} />
							Turned on<span class="sr">: {rule.name}</span>
						</label>
						<button type="button" onclick={() => start(draftFromAlert(rule))}>Edit<span class="sr"> {rule.name}</span></button>
						{#if confirming === rule.id}
							<button type="button" class="danger" onclick={() => onremove(rule)}>Confirm remove<span class="sr"> {rule.name}</span></button>
							<button type="button" onclick={() => (confirming = '')}>Keep</button>
						{:else}
							<button type="button" onclick={() => (confirming = rule.id)}>Remove<span class="sr"> {rule.name}</span></button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.alerts { display: grid; gap: var(--y-s); min-width: 0; }
	h1, h2, p, ul { margin: 0; }
	h2 { font-size: 1.125rem; overflow-wrap: anywhere; }
	ul { padding: 0; list-style: none; }
	.tools, .actions, .row { display: flex; flex-wrap: wrap; align-items: end; gap: var(--x-2xs); }
	input, select, button { font: inherit; min-height: 2.75rem; padding: 0 var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button.primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.danger { border-color: var(--color-text); font-weight: 600; }
	.problem { font-weight: 600; }
	.muted { color: var(--color-muted); }
	.form { display: grid; gap: 0.75rem; max-width: 36rem; padding: var(--y-s) var(--x-s); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.form label { display: grid; gap: 0.25rem; }
	.form label > span { font-size: 0.875rem; color: var(--color-muted); }
	.form input:not([type='checkbox']), .form select { width: 100%; }
	.row > label { flex: 1 1 9rem; }
	.check, .form label.check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; }
	.check input { min-height: auto; width: 1.25rem; height: 1.25rem; }
	.rules { display: grid; gap: var(--y-2xs); }
	.rules li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--x-s); padding: var(--y-2xs) var(--x-2xs); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.what { display: grid; gap: 0.25rem; min-width: 0; flex: 1 1 18rem; overflow-wrap: anywhere; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
