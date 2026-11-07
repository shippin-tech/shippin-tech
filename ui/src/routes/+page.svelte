<section class="hero">
	<p class="brand">shippin.tech</p>
	<h1>Mail server administration.</h1>
	<p class="lede">Manage domains, accounts and settings for this mail installation.</p>
	<div class="actions">
		<a href="/portal">Open Portal</a>
		<a href="/login">Sign in</a>
		<a href="/mail">Mail</a>
		<a href="/calendar">Calendar</a>
		<a href="/contacts">Contacts</a>
	</div>
</section>

<style>
	.hero {
		display: grid;
		gap: var(--space-3);
		width: min(40rem, 100%);
		margin: var(--space-4) auto;
		padding: var(--space-4);
	}
	.brand { margin: 0; color: var(--color-brand); font-weight: 700; }
	h1, p { margin: 0; }
	.lede { color: var(--color-muted); }
	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-2);
	}
	.actions a {
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		background: var(--color-card);
		color: var(--color-accent-fg);
		text-decoration: none;
	}
	.actions a:hover { border-color: var(--color-accent); }
</style>
