<script lang="ts"></script>

<section class="cal">
	<header>
		<h1>Calendar</h1>
		<p>November 2026</p>
	</header>
	<ol>
		{#each ['Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6', 'Sat 7', 'Sun 8'] as day}
			<li>{day}</li>
		{/each}
	</ol>
	<p class="empty">No events this week.</p>
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
	ol { list-style: none; display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--space-2); padding: 0; margin: 0; }
	li { padding: var(--space-3) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); }
	.empty { color: var(--color-muted); }
</style>
