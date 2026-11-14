<script lang="ts">
	import { keyGuide, WHY_HERE } from './keys';
	import type { KeysVariant } from './variants';

	let { variant, detailsOpen = true }: { variant: KeysVariant; detailsOpen?: boolean } = $props();
	const guide = $derived(keyGuide(variant));
</script>

<aside class="key-notice" aria-label="About this key">
	<p class="title"><strong>{guide.title}</strong></p>
	<p class="why">{WHY_HERE}</p>
	<details open={detailsOpen}>
		<summary>What happens to it</summary>
		<dl>
			{#each guide.facts as fact (fact.label)}
				<dt>{fact.label}</dt>
				<dd>{fact.text}</dd>
			{/each}
			<dt>Proven by</dt>
			<dd>{guide.proof}</dd>
		</dl>
	</details>
	<p class="more"><a href="/keys">How every key on this server is kept</a></p>
</aside>

<style>
	.key-notice {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 2px solid var(--color-accent);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
	}
	.title {
		margin: 0;
		font-size: 1.05rem;
	}
	.why,
	.more {
		margin: 0;
	}
	dl {
		display: grid;
		grid-template-columns: minmax(8rem, max-content) 1fr;
		gap: var(--space-1) var(--space-3);
		margin: var(--space-2) 0 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	@media (max-width: 40rem) {
		dl {
			grid-template-columns: 1fr;
		}
		dd {
			margin-bottom: var(--space-2);
		}
	}
</style>
