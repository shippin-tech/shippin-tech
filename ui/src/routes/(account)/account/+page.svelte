<script lang="ts">
	import { onMount } from 'svelte';
	import AccountSecurity from '$lib/catalog/account/AccountSecurity.svelte';
	import {
		changePassword,
		createAppPassword,
		disableTwoFactor,
		enableTwoFactor,
		loadAppPasswords,
		loadTwoFactor,
		revokeAppPassword,
		type AppPassword
	} from '$lib/adapter/account';
	import { account } from '$lib/adapter/session';
	import { brand } from '$lib/brand/brand.generated';
	import { mcplEmit } from '$lib/mcpl/events';

	let twoFactor = $state(false);
	let apps = $state<AppPassword[]>([]);
	let phase = $state<'pending' | 'ready' | 'error'>('pending');
	let problem = $state('');
	const email = account()?.username ?? '';

	async function refresh() {
		[twoFactor, apps] = await Promise.all([loadTwoFactor(), loadAppPasswords()]);
		phase = 'ready';
	}

	onMount(() => {
		if (!account()) return;
		refresh().catch((err) => {
			phase = 'error';
			problem = err instanceof Error ? err.message : 'Account settings could not be loaded.';
		});
	});
</script>

<svelte:head><title>Account security</title></svelte:head>

{#if phase === 'pending'}
	<p class="note">Loading…</p>
{:else if phase === 'error'}
	<p class="note" role="alert">{problem}</p>
{:else}
	<AccountSecurity
		{email}
		issuer={brand.name}
		{twoFactor}
		appPasswords={apps}
		onpassword={(current, next, code) => changePassword(current, next, code).then(() => mcplEmit('account.password.changed', email))}
		onenable={(current, url) => enableTwoFactor(current, url).then(() => mcplEmit('account.twofactor.enabled', email)).then(refresh)}
		ondisable={(current, code) => disableTwoFactor(current, code).then(() => mcplEmit('account.twofactor.disabled', email)).then(refresh)}
		oncreateapp={(name) => createAppPassword(name).then(async (secret) => (mcplEmit('account.apppassword.created', email), await refresh(), secret))}
		onrevokeapp={(item) => revokeAppPassword(item.id).then(() => mcplEmit('account.apppassword.revoked', email)).then(refresh)}
	/>
{/if}

<style>
	.note { max-inline-size: 40rem; margin-inline: auto; padding: var(--space-3); }
</style>
