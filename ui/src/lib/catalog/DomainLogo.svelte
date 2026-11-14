<script lang="ts">
	import BrandLogo from './BrandLogo.svelte';
	import { logoUrl } from '$lib/shippin/org/brand-call';

	let { domain = '' }: { domain?: string } = $props();

	let missing = $state('');
	const show = $derived(domain !== '' && missing !== domain);
</script>

{#if show}
	<img src={logoUrl(domain)} alt="{domain} logo" onerror={() => (missing = domain)} />
{:else}
	<BrandLogo />
{/if}

<style>
	img { display: block; block-size: 2.25rem; inline-size: auto; max-inline-size: 12rem; object-fit: contain; }
</style>
