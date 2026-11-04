<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import Theme from '$lib/catalog/theme/Theme.svelte';
	import type { ThemeChoice } from '$lib/catalog/theme/variants';

	let { children } = $props();
	let choice = $state<ThemeChoice>('system');

	onMount(() => {
		const saved = localStorage.getItem('shippin-theme');
		if (saved === 'harbor' || saved === 'kelp') choice = saved;
	});

	function onchange(next: ThemeChoice) {
		choice = next;
		if (next === 'system') {
			delete document.documentElement.dataset.theme;
			localStorage.removeItem('shippin-theme');
			return;
		}
		document.documentElement.dataset.theme = next;
		localStorage.setItem('shippin-theme', next);
	}
</script>

<a class="skip" href="#content">Skip to content</a>
<header>
	<Theme value={choice} {onchange} />
</header>
<main id="content">
	{@render children()}
</main>

<style>
	header {
		display: flex;
		justify-content: flex-end;
		padding: var(--space-3);
	}
</style>
