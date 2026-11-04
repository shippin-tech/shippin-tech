<script lang="ts">
	type Event = { id: string; name: string; detail: string };
	type Props = { events: Event[]; notice: string };
	let { events, notice }: Props = $props();
</script>

<section class="cal">
	<header>
		<h1>Calendar</h1>
		<p>From the mail engine</p>
	</header>
	{#if notice}
		<p class="empty">{notice}</p>
	{:else if events.length === 0}
		<p class="empty">No events yet.</p>
	{:else}
		<ul>
			{#each events as event (event.id)}
				<li>
					<strong>{event.name}</strong>
					{#if event.detail}<span>{event.detail}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.cal {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
	h1, p { margin: 0; }
	h1 { color: var(--color-brand); }
	ul { list-style: none; display: grid; gap: var(--space-2); padding: 0; margin: 0; }
	li { display: grid; gap: var(--space-1); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); }
	span, .empty { color: var(--color-muted); }
</style>
