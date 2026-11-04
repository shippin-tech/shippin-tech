<script lang="ts">
	import { session } from './session.svelte';
	let { children } = $props();
</script>

<nav>
	<a href="/admin">Control plane</a>
	<a href="/admin/directory">Tenants</a>
	<a href="/admin/domain">Domains</a>
	<a href="/admin/account">Accounts</a>
	<a href="/admin/scim">SCIM</a>
</nav>
<form class="session" onsubmit={(event) => event.preventDefault()}>
	<label>Engine user <input name="username" autocomplete="username" bind:value={session.username} /></label>
	<label>Engine secret <input name="password" type="password" autocomplete="current-password" bind:value={session.password} /></label>
</form>
{@render children()}

<style>
	nav { display: flex; gap: var(--space-3); padding: var(--space-3); }
	.session { display: flex; gap: var(--space-3); padding: 0 var(--space-3); }
	label { display: grid; gap: var(--space-1); color: var(--color-muted); }
	input { font: inherit; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-input); color: var(--color-text); }
</style>
