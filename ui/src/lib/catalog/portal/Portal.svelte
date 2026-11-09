<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { layouts } from '$lib/portal/catalog';
	import Search from './Search.svelte';

	let { active = '', children }: { active?: string; children: Snippet } = $props();
	const onSecurity = $derived(page.url.pathname.replace(/\/+$/, '') === '/portal/security');

	function current(view: string): boolean {
		if (active === view) return true;
		return active === '' && view === 'CustomComponent/Dashboard';
	}

	function open(items: readonly { view: string; children: readonly { view: string }[] }[]): boolean {
		return items.some((item) => current(item.view) || item.children.some((child) => current(child.view)));
	}
</script>

<div class="shell">
	<div class="side">
	<Search />
	<nav aria-label="Portal">
		<ul class="pinned">
			<li><a href="/portal/security" aria-current={onSecurity ? 'page' : undefined}>Security baseline</a></li>
		</ul>
		{#each layouts as layout (layout.name)}
			<details open={open(layout.items)}>
				<summary>{layout.name}</summary>
				<ul>
					{#each layout.items as item (item.name)}
						<li>
							{#if item.view}
								<a href="/portal/{item.view}" aria-current={current(item.view) ? 'page' : undefined}>{item.name}</a>
							{:else}
								<span>{item.name}</span>
								<ul>
									{#each item.children as child (child.view)}
										<li>
											<a href="/portal/{child.view}" aria-current={current(child.view) ? 'page' : undefined}>{child.name}</a>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/each}
	</nav>
	</div>
	<div class="view">
		{@render children()}
	</div>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
		gap: var(--x-s);
		align-items: start;
	}
	nav {
		display: grid;
		gap: var(--y-2xs);
		padding: var(--y-2xs);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	details { padding-block: var(--y-3xs); }
	summary {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		cursor: pointer;
		font-family: var(--font-display);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 0 var(--x-2xs);
		display: grid;
	}
	span {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		color: var(--color-muted);
	}
	a {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		color: var(--color-text);
		text-decoration: none;
	}
	a[aria-current='page'] {
		color: var(--brand-text);
		font-weight: 650;
	}
	.side {
		display: grid;
		gap: var(--y-2xs);
		align-content: start;
	}
	.view { min-inline-size: 0; }
	.pinned { list-style: none; margin: 0 0 var(--space-2); padding: 0; }
	.pinned a { font-weight: 600; }
	@media (max-width: 56rem) {
		.shell { grid-template-columns: minmax(0, 1fr); }
	}
</style>
