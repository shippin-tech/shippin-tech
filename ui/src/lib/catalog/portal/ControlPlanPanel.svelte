<script lang="ts">
	import { deploymentLanes, scriptedEvents } from '$lib/portal/control-plan';
</script>

<section class="panel" aria-label="Enterprise control plan">
	<h2>Enterprise control plan</h2>
	<p class="intro">Offer all client lanes with one guided operating model.</p>
	<div class="lanes">
		{#each deploymentLanes as lane (lane.id)}
			<article>
				<h3>{lane.label}</h3>
				<p><strong>Use:</strong> {lane.whenToUse}</p>
				<p><strong>Isolation:</strong> {lane.isolation}</p>
				<ul>
					{#each lane.operations as step (step)}
						<li>{step}</li>
					{/each}
				</ul>
			</article>
		{/each}
	</div>
	<h3>Scripted events standard</h3>
	<ul class="events">
		{#each scriptedEvents as event (event.id)}
			<li>
				<code>{event.id}</code>
				<span>{event.label} — {event.purpose}</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.panel {
		display: grid;
		gap: var(--y-2xs);
		padding: var(--y-s) var(--x-s);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	h2, h3, p { margin: 0; }
	.intro { color: var(--color-muted); }
	.lanes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
		gap: var(--x-s);
	}
	article {
		display: grid;
		gap: var(--y-3xs);
		padding: var(--y-s) var(--x-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-card), var(--color-bg) 20%);
	}
	ul { margin: 0; padding-inline-start: 1rem; }
	.events {
		display: grid;
		gap: var(--y-3xs);
		list-style: none;
		padding: 0;
	}
	.events li {
		display: grid;
		gap: var(--y-4xs);
		padding: var(--y-3xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	code {
		font-family: var(--font-mono);
		color: var(--color-brand);
	}
</style>
