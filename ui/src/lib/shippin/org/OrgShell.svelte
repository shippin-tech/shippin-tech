<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	let { children }: { children: Snippet } = $props();

	const BASE = '/shippin/org';
	const links = [
		{ label: 'Overview', href: BASE },
		{ label: 'People', href: `${BASE}/people` },
		{ label: 'Teams', href: `${BASE}/teams` },
		{ label: 'Domains', href: `${BASE}/domains` }
	];
	const path = $derived(page.url.pathname.replace(/\/+$/, ''));
</script>

<div class="shell">
	<nav aria-label="Organisation">
		<ul>
			{#each links as link (link.href)}
				<li><a href={link.href} aria-current={path === link.href ? 'page' : undefined}>{link.label}</a></li>
			{/each}
		</ul>
	</nav>
	<div class="view">
		{@render children()}
	</div>
</div>

<style>
	.shell { display: grid; grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr); gap: var(--x-s); align-items: start; max-width: 72rem; margin-inline: auto; padding: var(--y-s) var(--x-s); }
	nav { padding: var(--y-2xs); background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); }
	ul { list-style: none; margin: 0; padding: 0; display: grid; }
	a { min-height: 2.75rem; display: flex; align-items: center; padding-inline: var(--x-2xs); color: var(--color-text); text-decoration: none; }
	a[aria-current='page'] { color: var(--brand-text); font-weight: 650; }
	.view { min-inline-size: 0; }
	@media (max-width: 48rem) {
		.shell { grid-template-columns: minmax(0, 1fr); }
		ul { display: flex; flex-wrap: wrap; gap: var(--x-2xs); }
	}
</style>
