<script lang="ts">
	import { passwordProblem } from '$lib/panel/model';

	type Props = { oncreate: (email: string, password: string) => Promise<void> };
	let { oncreate }: Props = $props();

	let email = $state('');
	let password = $state('');
	let repeat = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
			error = 'Enter the address you will sign in with, like you@example.com.';
			return;
		}
		const weak = passwordProblem(password);
		if (weak) {
			error = weak;
			return;
		}
		if (password !== repeat) {
			error = 'The two passwords are different.';
			return;
		}
		busy = true;
		try {
			await oncreate(email.trim(), password);
		} catch (err) {
			error = err instanceof Error ? err.message : 'The administrator was not created.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="setup" aria-labelledby="setup-title">
	<h1 id="setup-title">Create your administrator</h1>
	<p>You signed in with the server's one-time setup key. Choose the address and password you will use from now on. The setup key stops working as soon as you finish. Next, sign in with your new address and author your keys: the dashboard shows you how.</p>
	<form onsubmit={submit} novalidate>
		<label for="setup-email">Your administrator address</label>
		<input id="setup-email" type="email" autocomplete="username" placeholder="you@example.com" bind:value={email} />
		<p class="muted">Its domain is added to the server if it is not there yet.</p>
		<label for="setup-password">Password</label>
		<input id="setup-password" type="password" autocomplete="new-password" bind:value={password} />
		<label for="setup-repeat">Repeat password</label>
		<input id="setup-repeat" type="password" autocomplete="new-password" bind:value={repeat} />
		{#if error}<p class="alert" role="alert">{error}</p>{/if}
		<button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create administrator'}</button>
	</form>
</section>

<style>
	.setup { display: grid; gap: var(--space-3); max-inline-size: 36rem; margin-inline: auto; padding: var(--space-4); background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); }
	h1, p { margin: 0; }
	.muted { color: var(--color-muted); font-size: 0.9em; }
	form { display: grid; gap: var(--space-2); }
	label { font-weight: 600; }
	input { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); }
	.alert { padding: var(--space-2) var(--space-3); border-inline-start: 3px solid var(--color-danger); background: var(--color-bg); }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-3); border-radius: var(--radius); border: 1px solid transparent; background: var(--color-accent); color: var(--color-accent-fg); cursor: pointer; justify-self: start; }
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
