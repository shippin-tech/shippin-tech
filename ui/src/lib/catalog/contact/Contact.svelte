<script lang="ts">
	type Person = { id: string; name: string };
	type Props = { people: Person[]; notice: string };
	let { people, notice }: Props = $props();
</script>

<section class="people">
	<h1>Contacts</h1>
	{#if notice}
		<p>{notice}</p>
	{:else if people.length === 0}
		<p>No contacts yet.</p>
	{:else}
		<ul>
			{#each people as person (person.id)}
				<li>{person.name}</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.people {
		min-height: 22rem;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-2);
		align-content: start;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	h1, p { margin: 0; }
	h1 { color: var(--color-brand); }
	p, li { color: var(--color-muted); }
	ul { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-2); }
	li { color: var(--color-text); padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); }
</style>
