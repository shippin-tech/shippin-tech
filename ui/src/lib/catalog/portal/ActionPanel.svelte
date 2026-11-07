<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import SchemaField from './SchemaField.svelte';
	import { defaultsFor, recordPatch, type PortalSchema, type ReferenceLoader } from '$lib/portal/schema';
	import { actionGroups, type ActionItem } from '$lib/portal/actions';

	let { schema, execute, references }: { schema: PortalSchema; references: ReferenceLoader; execute: (name: string, parameters: Record<string, unknown>) => Promise<Record<string, unknown>> } = $props();
	const groups = $derived(actionGroups((schema.schemas['x:Action']?.variants ?? []).map((variant) => ({ ...variant, schema: variant.schemaName ?? '' }))));
	let picked = $state<ActionItem | null>(null);
	let draft = $state<Record<string, unknown>>({});
	let result = $state<Record<string, unknown> | null>(null);
	let confirming = $state(false);
	let busy = $state(false);
	let error = $state('');
	const properties = $derived(schema.fields[picked?.schema ?? '']?.properties ?? {});
	const sections = $derived(schema.forms[picked?.schema ?? '']?.sections ?? []);
	function choose(action: ActionItem) {
		picked = action;
		draft = defaultsFor(schema, action.schema);
		result = null;
		error = '';
		confirming = !action.schema;
	}
	async function run() {
		if (!picked || busy) return;
		busy = true;
		error = '';
		confirming = false;
		try {
			const input = recordPatch(schema, picked.schema, {}, draft, true);
			result = { ...input, ...await execute(picked.name, input) };
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Action failed.';
		} finally { busy = false; }
	}
</script>

<section class="actions">
	<h1>Actions</h1><p>Execute server management actions</p>
	{#if !picked}
		{#each groups as group (group.label)}
			<section><h2>{group.label}</h2><div class="choices">
				{#each group.actions as action (action.name)}<button type="button" onclick={() => choose(action)}>{action.label}</button>{/each}
			</div></section>
		{/each}
	{:else}
		<h2>{picked.label}</h2>
		{#if error}<p role="alert">{error}</p>{/if}
		{#if result}<p role="status">Action executed successfully.</p>{/if}
		{#if busy}<p role="status">Running action...</p>{/if}
		{#if picked.schema}
			<form onsubmit={(event) => { event.preventDefault(); void run(); }} aria-busy={busy}>
				{#each sections as section, index (index)}
					{@const fields = section.fields.filter((field) => properties[field.name] && (result ? field.name in result : properties[field.name].update !== 'serverSet'))}
					{#if fields.length}<section><h3>{section.title ?? ''}</h3><div class="fields">
						{#each fields as field (field.name)}
							<SchemaField {schema} {references} spec={properties[field.name].type} label={field.label} path={field.name} value={(result ?? draft)[field.name]} disabled={busy || result !== null} onchange={(value) => draft = { ...draft, [field.name]: value }} />
						{/each}
					</div></section>{/if}
				{/each}
				{#if !result}<button type="submit" disabled={busy}>Execute</button>{/if}
			</form>
		{:else if !result && !confirming}<button type="button" disabled={busy} onclick={() => confirming = true}>Execute</button>{/if}
		<button type="button" disabled={busy} onclick={() => { picked = null; result = null; error = ''; }}>Back to actions</button>
	{/if}
</section>

<AlertDialog.Root bind:open={confirming}>
	<AlertDialog.Portal><AlertDialog.Overlay class="action-overlay" /><AlertDialog.Content class="action-dialog">
		<AlertDialog.Title>Run this action?</AlertDialog.Title><AlertDialog.Description>{picked?.label ?? ''}</AlertDialog.Description>
		<div class="row"><AlertDialog.Cancel>Cancel</AlertDialog.Cancel><AlertDialog.Action onclick={run}>Execute</AlertDialog.Action></div>
	</AlertDialog.Content></AlertDialog.Portal>
</AlertDialog.Root>

<style>
	.actions, section, form { display: grid; gap: var(--space-3); }
	h1, h2, h3, p { margin: 0; }
	.fields, .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr)); gap: var(--space-3); }
	button { font: inherit; min-height: 2.75rem; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); cursor: pointer; }
	button:disabled { opacity: .6; }
	p[role='alert'] { color: var(--color-danger); }
	:global(.action-overlay) { position: fixed; inset: 0; background: #0008; z-index: 50; }
	:global(.action-dialog) { position: fixed; inset: 50% auto auto 50%; transform: translate(-50%, -50%); background: var(--color-card); color: var(--color-text); padding: var(--space-4); border-radius: var(--radius); z-index: 51; }
	:global(.action-dialog .row) { display: flex; gap: var(--space-2); margin-block-start: var(--space-3); }
</style>
