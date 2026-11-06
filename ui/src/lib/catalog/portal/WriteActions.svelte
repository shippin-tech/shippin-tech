<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import {
		CANCEL,
		DELETE,
		SAVE,
		createLabel,
		deleteDescription,
		deleteItem,
		deleteTitle,
		writeNotice
	} from '$lib/portal/writes';

	let {
		name,
		label,
		creating = false,
		canDelete = false,
		oncreate,
		oncancel
	}: {
		name: string;
		label: string;
		creating?: boolean;
		canDelete?: boolean;
		oncreate?: () => void;
		oncancel?: () => void;
	} = $props();

	let open = $state(false);
	let notice = $state('');

	function save() {
		notice = writeNotice('unchanged');
	}

	function confirm() {
		open = false;
		notice = writeNotice('missing', name, true);
	}
</script>

<div class="actions">
	{#if creating}
		<button type="button" onclick={oncancel}>{CANCEL}</button>
		<button type="button" onclick={save}>{SAVE}</button>
	{:else}
		<button type="button" onclick={oncreate}>{createLabel(name)}</button>
		<button type="button" onclick={save}>{SAVE}</button>
		{#if canDelete}
			<button type="button" onclick={() => (open = true)}>{DELETE}</button>
		{/if}
	{/if}
</div>
	{#if notice}<p role="status">{notice}</p>{/if}

<AlertDialog.Root bind:open>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="write-overlay" />
		<AlertDialog.Content class="write-dialog">
			<AlertDialog.Title>{deleteTitle(name)}</AlertDialog.Title>
			<AlertDialog.Description>{deleteItem(label)}</AlertDialog.Description>
			<p>{deleteDescription(name)}</p>
			<div class="actions">
				<AlertDialog.Cancel>{CANCEL}</AlertDialog.Cancel>
				<AlertDialog.Action onclick={confirm}>{DELETE}</AlertDialog.Action>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<style>
	.actions { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	button, :global(.write-dialog button) {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		cursor: pointer;
	}
	p { margin: 0; }
	:global(.write-overlay) {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--color-text) 45%, transparent);
	}
	:global(.write-dialog) {
		position: fixed;
		inset: 50% auto auto 50%;
		transform: translate(-50%, -50%);
		display: grid;
		gap: var(--y-2xs);
		inline-size: min(100% - var(--x-s), 32rem);
		padding: var(--y-s) var(--x-s);
		background: var(--color-card);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	button:focus-visible,
	:global(.write-dialog button:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
