<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import { actions } from '$lib/portal/catalog';
	import {
		BACK,
		CANCEL,
		CONFIRM_TITLE,
		EXECUTE,
		FAILED,
		FAILED_TITLE,
		REQUIRED,
		SUBTITLE,
		TITLE,
		actionGroups,
		type ActionItem
	} from '$lib/portal/actions';

	const groups = actionGroups(actions);
	let picked = $state<ActionItem | null>(null);
	let notice = $state('');

	function choose(action: ActionItem) {
		notice = '';
		if (action.schema) {
			notice = REQUIRED;
			return;
		}
		picked = action;
	}

	function confirm() {
		picked = null;
		notice = FAILED;
	}
</script>

<section class="actions">
	<h1>{TITLE}</h1>
	<p>{SUBTITLE}</p>
	{#each groups as group (group.label)}
		<section>
			<h2>{group.label}</h2>
			{#each group.actions as action (action.name)}
				<button type="button" onclick={() => choose(action)}>{action.label}</button>
			{/each}
		</section>
	{/each}
	{#if notice === FAILED}
		<h2>{FAILED_TITLE}</h2>
		<p role="alert">{FAILED}</p>
		<button type="button" onclick={() => (notice = '')}>{BACK}</button>
	{:else if notice}
		<p role="status">{notice}</p>
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
				<AlertDialog.Cancel>{CANCEL}</AlertDialog.Cancel>
				<AlertDialog.Action onclick={confirm}>{EXECUTE}</AlertDialog.Action>
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
