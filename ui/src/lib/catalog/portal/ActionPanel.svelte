<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import { actionResult, actionSet } from '$lib/adapter/action-call';
	import { accountId, jmap } from '$lib/adapter/jmap';
	import { scriptedEvents } from '$lib/portal/control-plan';
	import { actions } from '$lib/portal/catalog';
	import {
		ANOTHER,
		BACK,
		CANCEL,
		CONFIRM_TITLE,
		EXECUTE,
		FAILED,
		FAILED_TITLE,
		REQUIRED,
		RUNNING,
		SIGN_IN_REQUIRED,
		SUBTITLE,
		TITLE,
		actionNotice,
		actionGroups,
		type ActionItem
	} from '$lib/portal/actions';

	const groups = actionGroups(actions);
	let picked = $state<ActionItem | null>(null);
	let notice = $state('');
	let busy = $state(false);

	function choose(action: ActionItem) {
		if (busy) return;
		notice = '';
		if (action.schema) {
			notice = REQUIRED;
			return;
		}
		picked = action;
	}

	async function runAction(name: string, label: string) {
		try {
			busy = true;
			notice = RUNNING;
			const responses = await jmap([], [actionSet(accountId(), name)]);
			const payload = responses.find((response) => response[0] === 'x:Action/set')?.[1] as
				| Record<string, unknown>
				| undefined;
			notice = actionNotice(actionResult(payload ?? {}, 'a0'), label);
		} catch (err) {
			const text = err instanceof Error ? err.message : FAILED;
			notice = text === 'sign-in required' ? SIGN_IN_REQUIRED : `${FAILED} ${text}`;
		} finally {
			busy = false;
		}
	}

	async function confirm() {
		if (!picked || busy) return;
		const choice = picked;
		picked = null;
		await runAction(choice.name, choice.label);
	}

	async function runScriptedAction(name: string, label: string) {
		if (busy) return;
		await runAction(name, label);
	}
</script>

<section class="actions">
	<h1>{TITLE}</h1>
	<p>{SUBTITLE}</p>
	<section>
		<h2>Scripted events</h2>
		{#each scriptedEvents as event (event.id)}
			<button type="button" onclick={() => runScriptedAction(event.actionName, event.label)} disabled={busy}>
				{event.label}
			</button>
		{/each}
	</section>
	{#each groups as group (group.label)}
		<section>
			<h2>{group.label}</h2>
			{#each group.actions as action (action.name)}
				<button type="button" onclick={() => choose(action)} disabled={busy}>{action.label}</button>
			{/each}
		</section>
	{/each}
	{#if notice === FAILED}
		<h2>{FAILED_TITLE}</h2>
		<p role="alert">{FAILED}</p>
		<button type="button" onclick={() => (notice = '')}>{BACK}</button>
	{:else if notice}
		<p role="status">{notice}</p>
		{#if !busy}
			<button type="button" onclick={() => (notice = '')}>{ANOTHER}</button>
		{/if}
	{/if}
</section>

<AlertDialog.Root
	open={picked != null}
	onOpenChange={(open) => {
		if (!open) picked = null;
	}}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="action-overlay" />
		<AlertDialog.Content class="action-dialog">
			<AlertDialog.Title>{CONFIRM_TITLE}</AlertDialog.Title>
			<AlertDialog.Description>{picked?.label ?? ''}</AlertDialog.Description>
			<div class="row">
				<AlertDialog.Cancel disabled={busy}>{CANCEL}</AlertDialog.Cancel>
				<AlertDialog.Action onclick={confirm} disabled={busy}>{EXECUTE}</AlertDialog.Action>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<style>
	.actions, section { display: grid; gap: var(--y-2xs); justify-items: start; }
	h1, h2, p { margin: 0; }
	h2 { color: var(--color-muted); }
	button, :global(.action-dialog button) {
		font: inherit;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		cursor: pointer;
	}
	.row, :global(.action-dialog .row) { display: flex; gap: var(--x-2xs); }
	button:focus-visible, :global(.action-dialog button:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
