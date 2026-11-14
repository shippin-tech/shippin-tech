<script lang="ts">
	import { brand } from '$lib/brand/brand.generated';
</script>

<span class="lockup">
	<span class="glyph" aria-hidden="true">{@html brand.markSvg}</span>
	<span class="word">{@html brand.wordmarkSvg}</span>
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
	/* Pixel wordmark: 9 cell rows (7 cap + 2 descender). 1.45rem tall puts the cap height near 1.15rem. */
	.word :global(svg) {
		display: block;
		block-size: 1.45rem;
		inline-size: auto;
		color: inherit;
	}
</style>
