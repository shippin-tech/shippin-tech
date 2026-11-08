<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import Theme from '$lib/catalog/theme/Theme.svelte';
	import Logo from '$lib/catalog/brand/Logo';
	import type { ThemeChoice } from '$lib/catalog/theme/variants';

	let { children } = $props();
	let choice = $state<ThemeChoice>('system');

	onMount(() => {
		const saved = localStorage.getItem('shippin-theme');
		if (saved === 'light' || saved === 'dark') choice = saved;
	});

	function apply(next: ThemeChoice) {
		const root = document.documentElement;
		if (next === 'system') {
			delete root.dataset.theme;
			localStorage.removeItem('shippin-theme');
			root.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
			return;
		}
		root.dataset.theme = next;
		root.classList.toggle('dark', next === 'dark');
		localStorage.setItem('shippin-theme', next);
	}

	function onchange(next: ThemeChoice) {
		choice = next;
		apply(next);
	}
</script>

<a class="skip" href="#content">Skip to content</a>
<header>
	<a class="mark" href="/portal" aria-label="Shippin portal home"><Logo /></a>
	<nav aria-label="Main navigation">
		<a href="/portal" aria-current={page.url.pathname.startsWith('/portal') ? 'page' : undefined}>Portal</a>
		<a href="/platform" aria-current={page.url.pathname.startsWith('/platform') ? 'page' : undefined}>Platform</a>
		<a href="/mail" aria-current={page.url.pathname.startsWith('/mail') ? 'page' : undefined}>Mail</a>
		<a href="/files" aria-current={page.url.pathname.startsWith('/files') ? 'page' : undefined}>Drive</a>
		<a href="/docs" aria-current={page.url.pathname.startsWith('/docs') ? 'page' : undefined}>Docs</a>
		<a href="/calendar" aria-current={page.url.pathname.startsWith('/calendar') ? 'page' : undefined}>Calendar</a>
		<a href="/contacts" aria-current={page.url.pathname.startsWith('/contacts') ? 'page' : undefined}>Contacts</a>
		<a href="/login" aria-current={page.url.pathname.startsWith('/login') ? 'page' : undefined}>Sign in</a>
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
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.mark :global(svg) { inline-size: 11.25rem; block-size: auto; max-inline-size: 100%; }
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
