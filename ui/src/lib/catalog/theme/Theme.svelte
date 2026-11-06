<script lang="ts">
	import { themes, type ThemeChoice } from './variants';

	type Props = {
		value: ThemeChoice;
		onchange: (value: ThemeChoice) => void;
	};
	let { value, onchange }: Props = $props();

	const labels: Record<ThemeChoice, string> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark'
	};
</script>

<div class="switch" role="radiogroup" aria-label="Color theme">
	{#each themes as theme}
		<button type="button" role="radio" aria-checked={value === theme} onclick={() => onchange(theme)}>
			{labels[theme]}
		</button>
	{/each}
</div>

<style>
	.switch {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	button {
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: var(--color-text);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	button[aria-checked='true'] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-color: var(--color-accent);
	}
</style>
