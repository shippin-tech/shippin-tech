<script lang="ts">
	import type { ReferenceLoader, ReferenceOption } from '$lib/portal/schema';
	let { name, label, value, load, onchange }: { name: string; label: string; value: unknown; load: ReferenceLoader; onchange: (value: string) => void } = $props();
	let options = $state<ReferenceOption[]>([]);
	let pending = $state(true);
	let error = $state('');
	$effect(() => {
		let cancelled = false;
		pending = true;
		error = '';
		load(name).then((items) => { if (!cancelled) options = items; })
			.catch((cause) => { if (!cancelled) error = cause instanceof Error ? cause.message : 'Could not load choices.'; })
			.finally(() => { if (!cancelled) pending = false; });
		return () => { cancelled = true; };
	});
</script>

<select aria-label={label} aria-busy={pending} value={String(value ?? '')} onchange={(event) => onchange(event.currentTarget.value)}>
	<option value="">{pending ? 'Loading choices...' : `Select ${label}`}</option>
	{#if value && !options.some((item) => item.id === value)}<option value={String(value)}>{String(value)}</option>{/if}
	{#each options as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
</select>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	select { box-sizing: border-box; width: 100%; background: var(--color-input); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-2); font: inherit; }
	p { color: var(--color-danger); margin: 0; }
</style>
