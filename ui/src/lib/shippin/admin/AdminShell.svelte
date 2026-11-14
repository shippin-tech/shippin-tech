<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { layouts } from '$lib/portal/catalog';
	import Search from './Search.svelte';
	import { ADMIN_MENU, isCurrent, settingsMenu } from './menu';

	let { active = '', children }: { active?: string; children: Snippet } = $props();

	const path = $derived(page.url.pathname.replace(/\/+$/, ''));
	const settings = settingsMenu(layouts);

	function current(view: string): boolean {
		return active !== '' && active === view;
	}

	function open(items: readonly { view: string; children: readonly { view: string }[] }[]): boolean {
		return items.some((item) => current(item.view) || item.children.some((child) => current(child.view)));
	}
</script>

<div class="shell">
	<div class="side">
	<Search />
	<nav aria-label="Admin">
		{#each ADMIN_MENU as group (group.name)}
			<section class="group">
				<h2>{group.name}</h2>
				<ul class="pinned">
					{#each group.links as link (link.href)}
						<li><a href={link.href} aria-current={isCurrent(path, link.href) ? 'page' : undefined}>{link.label}</a></li>
					{/each}
				</ul>
			</section>
		{/each}
		<section class="group">
			<h2>All settings</h2>
			{#each settings as layout (layout.name)}
				<details open={open(layout.items)}>
					<summary>{layout.name}</summary>
					<ul>
						{#each layout.items as item (item.name)}
							<li>
								{#if item.view}
									<a href="/shippin/admin/{item.view}" aria-current={current(item.view) ? 'page' : undefined}>{item.name}</a>
								{:else}
									<span>{item.name}</span>
									<ul>
										{#each item.children as child (child.view)}
											<li>
												<a href="/shippin/admin/{child.view}" aria-current={current(child.view) ? 'page' : undefined}>{child.name}</a>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				</details>
			{/each}
		</section>
	</nav>
	</div>
	<div class="view">
		{@render children()}
	</div>
</div>

<style>
	.group { display: grid; gap: 0.125rem; }
	h2 { margin: 0; font-size: 0.875rem; color: var(--color-muted); font-family: var(--font-display); }
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
