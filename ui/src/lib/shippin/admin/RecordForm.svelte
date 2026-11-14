<script lang="ts">
	import Copy from './Copy.svelte';

	type Field = { name: string; label: string; type: string; format: string };
	type Section = { title: string; fields: readonly Field[] };

	let {
		sections,
		picked
	}: {
		sections: readonly Section[];
		picked?: Record<string, string>;
	} = $props();
</script>

{#each sections as section, index (section.title + index)}
	<section class="form">
		{#if section.title}<h2>{section.title}</h2>{/if}
		<div class="fields">
			{#each section.fields as field (field.name)}
				<label>
					{field.label}
					<span class="pair">
						<input
							name={field.name}
							readonly
							value={picked?.[field.name] ?? ''}
							data-field-type={field.type}
							data-field-format={field.format}
						/>
						{#if picked?.[field.name]}
							<Copy value={picked[field.name]} label={field.label} />
						{/if}
					</span>
				</label>
			{/each}
		</div>
	</section>
{/each}

<style>
	h2 { margin: 0; }
	.form {
		display: grid;
		gap: var(--y-2xs);
		padding: var(--y-s) var(--x-s);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr));
		gap: var(--x-s);
	}
	label { display: grid; gap: var(--y-3xs); }
	.pair {
		display: flex;
		align-items: center;
		gap: var(--x-2xs);
	}
	.pair input { flex: 1; min-inline-size: 0; }
	input {
		font: inherit;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-input);
		color: var(--color-text);
	}
</style>
