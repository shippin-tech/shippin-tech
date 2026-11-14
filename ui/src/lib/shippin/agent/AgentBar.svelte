<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { agent, answer, boundActions, connectViewport, onAction } from './agent.svelte';
	import { allowedRoute, phaseText, shownArguments } from './agent-call';

	onMount(() => {
		const close = connectViewport();
		const unbindRead = onAction('screen.read', async () => {
			const heading = document.querySelector('main h1')?.textContent?.trim() ?? '';
			return {
				text: `The operator is on ${location.pathname}${heading ? `, "${heading}"` : ''}.`,
				data: { route: location.pathname, title: document.title, heading, actionsHere: boundActions() }
			};
		});
		const unbindGo = onAction('screen.go', async (args) => {
			if (!allowedRoute(args.route)) throw new Error('Only pages of the admin panel can be opened, such as /shippin/admin/keys.');
			await goto(args.route);
			return { text: `Opened ${args.route} on the operator's screen.`, data: { route: args.route } };
		});
		return () => {
			unbindRead();
			unbindGo();
			close();
		};
	});

	const call = $derived(agent.call);
</script>

<aside class="agent-bar" class:busy={!!call} aria-label="AI agent">
	{#if call && agent.phase !== 'idle'}
		<p role="status"><strong>{phaseText(call, agent.phase)}</strong></p>
		{#if shownArguments(call).length}
			<dl>
				{#each shownArguments(call) as item (item.name)}
					<dt>{item.name}</dt>
					<dd>{item.value}</dd>
				{/each}
			</dl>
		{/if}
		{#if agent.phase === 'asking'}
			<div class="row">
				<button type="button" class="primary" onclick={() => answer(true)}>Allow</button>
				<button type="button" onclick={() => answer(false)}>Deny</button>
			</div>
		{/if}
	{:else}
		<p role="status" class="muted">
			{agent.connected ? 'An AI agent can work on this screen. You will see everything it does, and allow anything that changes.' : 'Not connected for AI agents.'}
			{#if agent.last}<span class:problem={!agent.lastOk}> Last: {agent.last}</span>{/if}
		</p>
	{/if}
</aside>

<style>
	.agent-bar {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--color-border);
		background: var(--color-card);
		color: var(--color-text);
	}
	.agent-bar.busy {
		border-top: 3px solid var(--color-accent);
	}
	p,
	dl {
		margin: 0;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0 var(--space-3);
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.row {
		display: flex;
		gap: var(--space-2);
	}
	.muted {
		color: var(--color-muted);
	}
	.problem {
		color: var(--color-danger);
	}
	:global(.agent-focus) {
		outline: 3px solid var(--color-accent);
		outline-offset: 4px;
		transition: outline-color 0.3s;
	}
</style>
