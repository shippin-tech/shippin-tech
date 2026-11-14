<script lang="ts">
	import SchemaField from './SchemaField.svelte';
	import ReferenceField from './ReferenceField.svelte';
	import { defaultsFor, initialForType, type PortalSchema, type PropertyType, type ReferenceLoader } from '$lib/portal/schema';
	let { schema, spec, label, path, value, disabled = false, creating = true, references, onchange }: {
		schema: PortalSchema; spec: PropertyType; label: string; path: string;
		value: unknown; disabled?: boolean; creating?: boolean; references?: ReferenceLoader; onchange: (value: unknown) => void;
	} = $props();
	const options = $derived(schema.enums[spec.enumName ?? '']);
	const variants = $derived(schema.schemas[spec.objectName ?? '']?.variants ?? []);
	const object = $derived(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
	const variant = $derived(variants.find((item) => item.name === object['@type']));
	const nestedName = $derived(variant?.schemaName ?? (variants.length ? '' : spec.objectName ?? ''));
	const fields = $derived(schema.fields[nestedName]?.properties ?? {});
	function initial(): unknown {
		return initialForType(schema, { ...spec, nullable: false });
	}
</script>

<fieldset disabled={disabled}>
	<legend>{label}</legend>
	{#if spec.nullable}
		<label class="toggle"><input type="checkbox" checked={value !== null && value !== undefined} onchange={(event) => onchange(event.currentTarget.checked ? initial() : null)} /> Set {label}</label>
	{/if}
	{#if !spec.nullable || (value !== null && value !== undefined)}
		{#if spec.type === 'boolean'}
			<label class="toggle"><input type="checkbox" checked={value === true} onchange={(event) => onchange(event.currentTarget.checked)} /> {label}</label>
		{:else if spec.type === 'enum' && Array.isArray(options)}
			<select aria-label={label} value={typeof value === 'string' ? value : ''} onchange={(event) => onchange(event.currentTarget.value)}>
				<option value="">Select {label}</option>
				{#each options as option (option.name)}<option value={option.name}>{option.label ?? option.name}</option>{/each}
			</select>
		{:else if spec.type === 'object'}
			{#if variants.length}
				<select aria-label={label} value={String(object['@type'] ?? '')} onchange={(event) => {
					const next = variants.find((item) => item.name === event.currentTarget.value);
					onchange({ ...defaultsFor(schema, next?.schemaName ?? ''), '@type': next?.name });
				}}>
					<option value="">Select {label}</option>
					{#each variants as option (option.name)}<option value={option.name}>{option.label}</option>{/each}
				</select>
			{/if}
			{#each Object.entries(fields) as [name, property] (name)}
				<SchemaField {schema} {creating} {references} spec={property.type} label={schema.forms[nestedName]?.sections.flatMap((section) => section.fields).find((field) => field.name === name)?.label ?? name} path={`${path}.${name}`} value={object[name]} disabled={disabled || property.update === 'serverSet' || (!creating && property.update === 'immutable')} onchange={(next) => onchange({ ...object, [name]: next })} />
				{#if property.description}<p class="help">{property.description}</p>{/if}
			{/each}
		{:else if spec.type === 'set'}
			{#each Object.keys(object).filter((key) => object[key] === true) as key, index (index)}
				<div class="item">
					<SchemaField {schema} {creating} {references} spec={spec.class ?? { type: 'string' }} label={`${label} ${index + 1}`} path={`${path}.${index}`} value={spec.class?.type === 'number' ? Number(key) : key} {disabled} onchange={(next) => onchange(Object.fromEntries(Object.entries(object).map(([name, item]) => [name === key ? String(next) : name, item])))} />
					<button type="button" onclick={() => onchange(Object.fromEntries(Object.entries(object).filter(([name]) => name !== key)))}>Remove {label} {index + 1}</button>
				</div>
			{/each}
			<button type="button" onclick={() => onchange({ ...object, '': true })}>Add {label}</button>
		{:else if spec.type === 'objectList'}
			{#each Object.entries(object) as [key, item], index (key)}
				<div class="item">
					<SchemaField {schema} {creating} {references} spec={{ type: 'object', objectName: spec.objectName }} label={`${label} ${index + 1}`} path={`${path}.${key}`} value={item} {disabled} onchange={(next) => onchange({ ...object, [key]: next })} />
					<button type="button" onclick={() => onchange(Object.fromEntries(Object.entries(object).filter(([name]) => name !== key)))}>Remove {label} {index + 1}</button>
				</div>
			{/each}
			<button type="button" onclick={() => {
				const key = String(Math.max(-1, ...Object.keys(object).map(Number).filter(Number.isFinite)) + 1);
				onchange({ ...object, [key]: initialForType(schema, { type: 'object', objectName: spec.objectName }) });
			}}>Add {label}</button>
		{:else if spec.type === 'map'}
			{#each Object.entries(object) as [name, item] (name)}
				<div class="item"><SchemaField {schema} {creating} {references} spec={spec.valueClass ?? { type: 'string' }} label={name} path={`${path}.${name}`} value={item} {disabled} onchange={(next) => onchange({ ...object, [name]: next })} />
				<button type="button" onclick={() => onchange(Object.fromEntries(Object.entries(object).filter(([key]) => key !== name)))}>Remove {name}</button></div>
			{/each}
			<label>Add key <input aria-label={`New ${label} key`} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const key = event.currentTarget.value.trim(); if (key && !Object.hasOwn(object, key)) { onchange({ ...object, [key]: initialForType(schema, spec.valueClass ?? { type: 'string' }) }); event.currentTarget.value = ''; } } }} /></label>
		{:else if spec.type === 'objectId' && spec.objectName && references && !disabled}
			<ReferenceField name={spec.objectName} {label} {value} load={references} onchange={(next) => onchange(next)} />
		{:else if spec.format === 'text' || spec.format === 'script'}
			<textarea aria-label={label} value={String(value ?? '')} oninput={(event) => onchange(event.currentTarget.value)} rows="5"></textarea>
		{:else if spec.type === 'number'}
			<input aria-label={label} type="number" step="any" value={typeof value === 'number' ? value : ''} oninput={(event) => { if (Number.isFinite(event.currentTarget.valueAsNumber)) onchange(event.currentTarget.valueAsNumber); }} />
		{:else}
			<input aria-label={label} type={spec.format === 'secret' ? 'password' : spec.format === 'color' ? 'color' : 'text'} value={String(value ?? '')} autocomplete="off" oninput={(event) => onchange(event.currentTarget.value)} />
		{/if}
	{/if}
</fieldset>

<style>
	fieldset { min-inline-size: 0; border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-3); display: grid; gap: var(--space-2); }
	legend { padding-inline: var(--space-1); font-weight: 600; }
	input:not([type='checkbox']), select, textarea { box-sizing: border-box; width: 100%; background: var(--color-input); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-2); font: inherit; }
	.toggle { display: flex; gap: var(--space-2); align-items: center; }
	.item { display: grid; gap: var(--space-2); }
	.help { margin: 0; color: var(--color-muted); white-space: pre-line; }
	button { justify-self: start; background: var(--color-card); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-2); }
</style>
