<script lang="ts">
	import { brand } from '$lib/brand/brand.generated';
</script>

<span class="lockup" role="img" aria-label={brand.name}>
	<span class="glyph">{@html brand.markSvg}</span>
	<span class="word">{brand.nameParts[0]}<b>{brand.nameParts[1]}</b></span>
</span>

<style>
	.lockup {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		color: inherit;
		white-space: nowrap;
	}
	.glyph :global(svg) {
		display: block;
		inline-size: 2rem;
		block-size: 2rem;
	}
	.word {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-weight: 700;
		font-size: 1.2rem;
		letter-spacing: 0.02em;
	}
	.word b {
		color: var(--brand-accent, #22d3ee);
	}
</style>
