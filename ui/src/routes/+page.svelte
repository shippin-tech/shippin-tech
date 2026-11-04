<script lang="ts">
	let email = $state('');
	let sent = $state(false);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!email.includes('@')) return;
		sent = true;
	}
</script>

<section class="hero">
	<p class="brand">shippin.tech</p>
	<h1>Mail, calendar, and contacts on your own server.</h1>
	<p class="lede">The engine is Rust. This screen is Svelte. Early access is a note of intent. Remotion comes after the product is further along.</p>
	<form onsubmit={submit}>
		<label>
			Email
			<input name="email" type="email" autocomplete="email" bind:value={email} required />
		</label>
		<button type="submit">Request early access</button>
		{#if sent}<p role="status">Intent recorded for {email}. There is no list behind this yet.</p>{/if}
	</form>
	<p><a href="/login">Sign in</a> to the mailbox on this server.</p>
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
	form { display: grid; gap: var(--space-2); }
	label { display: grid; gap: var(--space-1); }
	input, button {
		font: inherit;
		border-radius: var(--radius);
	}
	input {
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		background: var(--color-input);
		color: var(--color-text);
	}
	button {
		padding: var(--space-2) var(--space-3);
		border: 0;
		background: var(--color-accent);
		color: var(--color-accent-fg);
	}
</style>
