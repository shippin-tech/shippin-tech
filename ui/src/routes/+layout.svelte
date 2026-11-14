<script lang="ts">
	import { brand } from '$lib/brand/brand.generated';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import { account, clearSession, rememberReturnPath, sessionEventName } from '$lib/adapter/session';
	import DomainLogo from '$lib/catalog/DomainLogo.svelte';
	import AssistantDock from '$lib/shippin/assistant/AssistantDock.svelte';
	import { emailDomain } from '$lib/shippin/org/brand-call';
	import Theme from '$lib/catalog/theme/Theme.svelte';
	import type { ThemeChoice } from '$lib/catalog/theme/variants';
	import { currentRole, forgetRole, navFor, type NavItem, type Role } from '$lib/adapter/home';
	import { loadPlan } from '$lib/adapter/panel';
	import { portalSignals } from '$lib/adapter/signal';
	import { bindLessons, syncLessons } from '$lib/mcpl/lessons';
	import { fetchLessonProgress, pushLessonProgress } from '$lib/adapter/learn';

	let { children } = $props();
	// Before any page starts: an event a page fires as it opens must still count.
	const unbindLessons = browser
		? bindLessons(
				portalSignals.subscribe,
				() => account()?.username ?? null,
				(lesson, progress) => void pushLessonProgress(lesson, progress)
			)
		: () => {};
	let choice = $state<ThemeChoice>('system');
	let signedIn = $state(false);
	let role = $state<Role>('guest');
	let signupOpen = $state(false);
	const items = $derived<NavItem[]>(navFor(role, signupOpen));
	const logoDomain = $derived(signedIn ? emailDomain(account()?.username ?? '') : '');

	async function refreshRole() {
		role = await currentRole();
	}

	const PROTECTED = ['/shippin/admin', '/platform', '/manage', '/shippin/org', '/account', '/mail', '/files', '/docs', '/calendar', '/contacts'];

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
		void refreshRole();
		const syncLearning = () => {
			const who = account()?.username;
			if (who) void syncLessons(who, fetchLessonProgress, pushLessonProgress);
		};
		syncLearning();
		loadPlan()
			.then((plan) => (signupOpen = plan.signup === 'open'))
			.catch(() => (signupOpen = false));
		const onSession = () => {
			signedIn = !!account();
			forgetRole();
			void refreshRole();
			applyAuthGate(page.url.pathname, page.url.search);
			syncLearning();
		};
		window.addEventListener(sessionEventName(), onSession);
		return () => {
			window.removeEventListener(sessionEventName(), onSession);
			unbindLessons();
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
		forgetRole();
		role = 'guest';
		void goto('/login', { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<svelte:head>
	<title>{brand.name}</title>
</svelte:head>

<a class="skip" href="#content">Skip to content</a>
<header>
	<a class="mark" href="/" aria-label="{brand.name} home">
		<DomainLogo domain={logoDomain} />
	</a>
	<nav aria-label="Main navigation">
		{#each items as item (item.href)}
			<a href={item.href} aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}>{item.label}</a>
		{/each}
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

{#if signedIn}<AssistantDock />{/if}

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
	}
	.mark { text-decoration: none; display: inline-flex; align-items: center; min-height: 2.75rem; }
	.mark :global(svg) { max-inline-size: 100%; }
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
