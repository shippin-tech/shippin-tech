<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import { account, clearSession, rememberReturnPath, sessionEventName } from '$lib/adapter/session';
	import BrandLogo from '$lib/catalog/BrandLogo.svelte';
	import Theme from '$lib/catalog/theme/Theme.svelte';
	import type { ThemeChoice } from '$lib/catalog/theme/variants';

	let { children } = $props();
	let choice = $state<ThemeChoice>('system');
	let signedIn = $state(false);

	const PROTECTED = ['/portal', '/platform', '/mail', '/files', '/docs', '/calendar', '/contacts'];

	function protectedPath(pathname: string): boolean {
		return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
	}

	function applyAuthGate(pathname: string, search: string): void {
		if (!browser) return;
		signedIn = !!account();
		if (!signedIn && protectedPath(pathname)) {
			rememberReturnPath(`${pathname}${search}`);
			void goto('/login', { replaceState: true, noScroll: true, keepFocus: true });
		}
	}

	onMount(() => {
		const saved = localStorage.getItem('shippin-theme');
		if (saved === 'light' || saved === 'dark') choice = saved;
		signedIn = !!account();
		applyAuthGate(page.url.pathname, page.url.search);
		const onSession = () => {
			signedIn = !!account();
			applyAuthGate(page.url.pathname, page.url.search);
		};
		window.addEventListener(sessionEventName(), onSession);
		return () => {
			window.removeEventListener(sessionEventName(), onSession);
		};
	});

	$effect(() => {
		applyAuthGate(page.url.pathname, page.url.search);
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

	function signout() {
		rememberReturnPath(page.url.pathname + page.url.search);
		clearSession();
		void goto('/login', { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<a class="skip" href="#content">Skip to content</a>
<header>
	<a class="mark" href="/portal" aria-label="Shippin portal home">
		<BrandLogo />
	</a>
	<nav aria-label="Main navigation">
		<a href="/portal" aria-current={page.url.pathname.startsWith('/portal') ? 'page' : undefined}>Portal</a>
		<a href="/platform" aria-current={page.url.pathname.startsWith('/platform') ? 'page' : undefined}>Platform</a>
		<a href="/mail" aria-current={page.url.pathname.startsWith('/mail') ? 'page' : undefined}>Mail</a>
		<a href="/files" aria-current={page.url.pathname.startsWith('/files') ? 'page' : undefined}>Drive</a>
		<a href="/docs" aria-current={page.url.pathname.startsWith('/docs') ? 'page' : undefined}>Docs</a>
		<a href="/calendar" aria-current={page.url.pathname.startsWith('/calendar') ? 'page' : undefined}>Calendar</a>
		<a href="/contacts" aria-current={page.url.pathname.startsWith('/contacts') ? 'page' : undefined}>Contacts</a>
		{#if signedIn}
			<button type="button" class="nav-button" onclick={signout}>Sign out</button>
		{:else}
			<a href="/login" aria-current={page.url.pathname.startsWith('/login') ? 'page' : undefined}>Sign in</a>
		{/if}
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
		font: inherit;
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		color: var(--color-text);
		text-decoration: none;
		border: 0;
		background: transparent;
	}
	.nav-button {
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		color: var(--color-text);
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	nav a[aria-current='page'] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
	}
	.nav-button:hover,
	.nav-button:focus-visible {
		background: var(--color-accent);
		color: var(--color-accent-fg);
	}
	header :global(.switch) { margin-left: auto; }
</style>
