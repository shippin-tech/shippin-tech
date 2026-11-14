<script lang="ts">
	import { KEY_GUIDES, WHY_HERE } from '$lib/shippin/keys/keys';
	import { variants } from '$lib/shippin/keys/variants';
</script>

<svelte:head><title>Your keys on this server</title></svelte:head>

<div class="keys">
	<h1>Your keys on this server</h1>
	<p>{WHY_HERE}</p>
	<p>
		Each key below either comes from you, made at the service it belongs to, or is made by this server
		at random for you to paste somewhere else. Here is what happens to each one, and the test that
		proves it.
	</p>
	{#each variants as id (id)}
		{@const guide = KEY_GUIDES[id]}
		<section aria-labelledby="key-{id}">
			<h2 id="key-{id}">{guide.title}</h2>
			<p class="origin">{guide.origin === 'yours' ? 'A key you bring' : 'A key this server makes for you'}</p>
			<dl>
				{#each guide.facts as fact (fact.label)}
					<dt>{fact.label}</dt>
					<dd>{fact.text}</dd>
				{/each}
				<dt>Proven by</dt>
				<dd>{guide.proof}</dd>
			</dl>
		</section>
	{/each}
	<section aria-labelledby="keys-yours">
		<h2 id="keys-yours">What stays with you</h2>
		<ul>
			<li>Paste a key only into the field made for it, on your own server's address.</li>
			<li>Never send a key by email or chat, and never paste it into an AI assistant's chat box.</li>
			<li>If a key may have been seen by someone else, replace it at its service and paste the new one here.</li>
		</ul>
	</section>
</div>

<style>
	.keys {
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-3);
		display: grid;
		gap: var(--space-3);
	}
	section {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 var(--space-1);
	}
	.origin {
		color: var(--color-muted);
		margin: 0 0 var(--space-2);
	}
	dl {
		display: grid;
		grid-template-columns: minmax(8rem, max-content) 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	@media (max-width: 40rem) {
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>
