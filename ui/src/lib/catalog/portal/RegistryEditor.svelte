<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import RecordTable from './RecordTable.svelte';
	import SchemaField from './SchemaField.svelte';
	import type { RegistryListControls } from '$lib/adapter/portal';
	import { defaultsFor, recordPatch, recordSchema, type PortalSchema, type ReferenceLoader } from '$lib/portal/schema';
	import type { PortalView } from '$lib/portal/catalog';
	type Change = { create: Record<string, Record<string, unknown>> } | { update: Record<string, Record<string, unknown>> } | { destroy: string[] };
	let {
		record,
		schema,
		records,
		rows,
		save,
		references,
		selectedId = '',
		onselectid,
		controls = { filterText: '', sortBy: '', sortAscending: true, limit: 25, position: 0 },
		total = null,
		hasPrev = false,
		hasNext = false,
		onquerychange
	}: {
		record: PortalView;
		schema: PortalSchema;
		records: Record<string, unknown>[];
		rows: Record<string, string>[];
		save: (change: Change, id: string) => Promise<string>;
		references: ReferenceLoader;
		selectedId?: string;
		onselectid?: (id: string) => void;
		controls?: RegistryListControls;
		total?: number | null;
		hasPrev?: boolean;
		hasNext?: boolean;
		onquerychange?: (next: Partial<RegistryListControls>) => void;
	} = $props();
	let selected = $state('');
	let creating = $state(false);
	let draft = $state<Record<string, unknown>>({});
	let busy = $state(false);
	let notice = $state('');
	let failed = $state(false);
	let deleting = $state(false);
	let filterText = $state('');
	const singleton = $derived(schema.objects[record.object]?.type === 'singleton');
	const picked = $derived(singleton ? records[0] : records.find((item) => item.id === selected));
	const variants = $derived(schema.schemas[record.object]?.variants ?? []);
	const filters = $derived(schema.lists[record.view]?.filtersStatic ?? {});
	const schemaName = $derived(recordSchema(schema, record.object, draft));
	const form = $derived(schema.forms[record.view] ?? schema.forms[schemaName]);
	const sections = $derived(form?.sections ?? []);
	const properties = $derived(schema.fields[schemaName]?.properties ?? {});
	const editable = $derived(Object.values(properties).some((property) => property.update !== 'serverSet'));
	const canCreate = $derived(variants.length > 0 || Object.values(schema.fields[record.object]?.properties ?? {}).some((property) => property.update !== 'serverSet'));
	const patch = $derived(recordPatch(schema, schemaName, picked ?? {}, draft, creating));
	const dirty = $derived(Object.keys(patch).length > 0);
	const sortBy = $derived(controls.sortBy || record.columns[0]?.name || '');
	$effect(() => {
		if (!creating) draft = JSON.parse(JSON.stringify(picked ?? {}));
	});
	$effect(() => {
		filterText = controls.filterText;
	});
	$effect(() => {
		selected = selectedId;
	});
	function select(index: number) {
		if (busy || (dirty && !confirm('Discard unsaved changes?'))) return;
		creating = false;
		selected = String(records[index].id);
		onselectid?.(selected);
		notice = '';
	}
	function create() {
		if (dirty && !confirm('Discard unsaved changes?')) return;
		selected = '';
		onselectid?.('');
		const type = filters['@type'] ?? variants[0]?.name;
		const initial = type ? { '@type': type } : {};
		draft = { ...defaultsFor(schema, recordSchema(schema, record.object, initial)), ...filters, ...initial };
		creating = true;
		notice = '';
	}
	async function submit(destroy = false) {
		if (busy || (!destroy && !dirty)) return;
		busy = true;
		notice = '';
		failed = false;
		try {
			const id = creating ? 'newRecord' : String(picked?.id ?? '');
			if (!id) throw new Error('Select a record first.');
			const data = creating && variants.length ? { ...patch, '@type': draft['@type'] } : patch;
			const change: Change = destroy ? { destroy: [id] } : creating ? { create: { [id]: data } } : { update: { [id]: patch } };
			const savedId = await save(change, id);
			creating = false;
			selected = destroy ? '' : savedId;
			onselectid?.(selected);
			notice = destroy ? 'Deleted successfully' : 'Saved successfully';
		} catch (error) {
			failed = true;
			notice = error instanceof Error ? error.message : 'The server did not confirm the change.';
		} finally {
			busy = false;
			deleting = false;
		}
	}
	function applyFilter() {
		onquerychange?.({ filterText, position: 0 });
	}
	function setSort(name: string) {
		onquerychange?.({ sortBy: name, position: 0 });
	}
	function setDirection(ascending: boolean) {
		onquerychange?.({ sortAscending: ascending, position: 0 });
	}
	function setLimit(next: number) {
		onquerychange?.({ limit: next, position: 0 });
	}
	function previous() {
		onquerychange?.({ position: Math.max(0, controls.position - controls.limit) });
	}
	function next() {
		onquerychange?.({ position: controls.position + controls.limit });
	}
</script>

<svelte:head><title>{record.listTitle || record.object} · ShippinTECH</title></svelte:head>
<article>
	<header><div><h1>{form?.title || record.listTitle || record.object}</h1><p>{form?.subtitle || record.listSubtitle || record.description}</p></div>
		{#if canCreate && !singleton && record.columns.length}<button type="button" onclick={create} disabled={busy}>Create {record.object.replace(/^x:/, '')}</button>{/if}
	</header>
	{#if record.columns.length && !singleton}
		<section class="list-controls" aria-label="Registry list controls">
			<form class="search" onsubmit={(event) => { event.preventDefault(); applyFilter(); }}>
				<label>
					Search
					<input
						type="search"
						value={filterText}
						oninput={(event) => (filterText = event.currentTarget.value)}
						placeholder="Filter server results"
						disabled={busy}
					/>
				</label>
				<button type="submit" disabled={busy}>Apply</button>
			</form>
			<label>
				Sort
				<select value={sortBy} onchange={(event) => setSort(event.currentTarget.value)} disabled={busy}>
					{#each record.columns as column (column.name)}
						<option value={column.name}>{column.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Direction
				<select value={controls.sortAscending ? 'asc' : 'desc'} onchange={(event) => setDirection(event.currentTarget.value === 'asc')} disabled={busy}>
					<option value="asc">Ascending</option>
					<option value="desc">Descending</option>
				</select>
			</label>
			<label>
				Page size
				<select value={String(controls.limit)} onchange={(event) => setLimit(Number(event.currentTarget.value))} disabled={busy}>
					<option value="25">25</option>
					<option value="50">50</option>
					<option value="100">100</option>
					<option value="200">200</option>
				</select>
			</label>
		</section>
	{/if}
	{#if record.columns.length}<RecordTable columns={record.columns} {rows} phase="ready" selected={records.findIndex((item) => item.id === selected)} onselect={select} />{/if}
	{#if record.columns.length && !singleton}
		<nav class="paging" aria-label="Registry pages">
			<button type="button" onclick={previous} disabled={busy || !hasPrev}>Previous</button>
			<p>
				Showing {Math.min(controls.position + 1, total ?? controls.position + rows.length)}-{controls.position + rows.length}
				{#if total != null} of {total}{/if}
			</p>
			<button type="button" onclick={next} disabled={busy || !hasNext}>Next</button>
		</nav>
	{/if}
	{#if notice}<p role={failed ? 'alert' : 'status'}>{notice}</p>{/if}
	{#if creating || picked}
		<form onsubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={busy}>
			{#if variants.length}<label>Record type <select aria-label="Record type" disabled={!creating || busy || !!filters['@type']} value={String(draft['@type'] ?? '')} onchange={(event) => {
				const type = event.currentTarget.value;
				draft = { ...defaultsFor(schema, recordSchema(schema, record.object, { '@type': type })), ...filters, '@type': type };
			}}>{#each variants as variant (variant.name)}<option value={variant.name}>{variant.label}</option>{/each}</select></label>{/if}
			{#each sections as section, index (index)}
				<section><h2>{section.title ?? ''}</h2><div class="fields">
					{#each section.fields as field (field.name)}
						{@const property = properties[field.name]}
						{#if property}
							<div><SchemaField {schema} {creating} {references} spec={property.type} label={field.label} path={field.name} value={draft[field.name]} disabled={busy || !editable || property.update === 'serverSet' || (!creating && property.update === 'immutable')} onchange={(value) => { draft = { ...draft, [field.name]: value }; notice = ''; }} />
							{#if property.description}<p class="help">{property.description}</p>{/if}</div>
						{/if}
					{/each}
				</div></section>
			{/each}
			{#if editable}<div class="actions">
				<button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
				{#if creating}<button type="button" disabled={busy} onclick={() => { creating = false; }}>Cancel</button>{/if}
				{#if picked && !singleton && !creating}<button type="button" disabled={busy} onclick={() => deleting = true}>Delete</button>{/if}
			</div>{/if}
		</form>
	{/if}
</article>
<AlertDialog.Root bind:open={deleting}><AlertDialog.Portal><AlertDialog.Overlay class="registry-overlay" /><AlertDialog.Content class="registry-dialog">
	<AlertDialog.Title>Delete this record?</AlertDialog.Title>
	<AlertDialog.Description>This permanently deletes the selected {record.listTitle || record.object} record.</AlertDialog.Description>
	<div class="actions"><AlertDialog.Cancel disabled={busy}>Cancel</AlertDialog.Cancel><button type="button" disabled={busy} onclick={() => submit(true)}>Delete</button></div>
</AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>

<style>
	article, form, section { display: grid; gap: var(--space-3); }
	header, .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
	h1, h2, p { margin: 0; }
	h2 { font-size: var(--step-m); }
	.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr)); gap: var(--space-3); }
	.list-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--space-2); align-items: end; }
	.list-controls .search { display: flex; gap: var(--space-2); align-items: end; }
	.list-controls .search label { flex: 1; }
	label { display: grid; gap: var(--space-1); }
	.paging { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
	.help, header p { color: var(--color-muted); font-size: .875rem; margin-block: var(--space-1); }
	.actions { justify-content: start; }
	button { background: var(--color-card); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
	button:disabled { opacity: .6; }
	p[role='alert'] { color: var(--color-danger); }
	:global(.registry-overlay) { position: fixed; inset: 0; background: #0008; z-index: 50; }
	:global(.registry-dialog) { position: fixed; inset: 50% auto auto 50%; transform: translate(-50%, -50%); background: var(--color-card); color: var(--color-text); padding: var(--space-4); border-radius: var(--radius); z-index: 51; max-width: min(32rem, 90vw); }
</style>
