<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
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
	<a class="mark" href="/">shippin</a>
	<nav>
		<a href="/mail" aria-current={page.url.pathname.startsWith('/mail') ? 'page' : undefined}>Mail</a>
		<a href="/calendar" aria-current={page.url.pathname.startsWith('/calendar') ? 'page' : undefined}>Calendar</a>
		<a href="/contacts" aria-current={page.url.pathname.startsWith('/contacts') ? 'page' : undefined}>Contacts</a>
		<a href="/files" aria-current={page.url.pathname.startsWith('/files') ? 'page' : undefined}>Files</a>
		<a href="/docs" aria-current={page.url.pathname.startsWith('/docs') ? 'page' : undefined}>Docs</a>
	</nav>
	<Theme value={choice} {onchange} />
</header>
<main id="content">
	{@render children()}
</main>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
	}
	.mark {
		color: var(--color-brand);
		font-weight: 700;
		text-decoration: none;
	}
	nav { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	nav a {
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		color: var(--color-text);
		text-decoration: none;
	}
	nav a[aria-current='page'] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
	}
	header :global(.switch) { margin-left: auto; }
</style>
