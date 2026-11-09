<script lang="ts">
	import { goto } from '$app/navigation';
	import { exchangeAuthorizationCode } from '$lib/adapter/oauth';
	import { consumeReturnPath } from '$lib/adapter/session';

	let alert = $state('');

	$effect(() => {
		let cancelled = false;
		exchangeAuthorizationCode()
			.then(() => {
				if (!cancelled) goto(consumeReturnPath('/portal'));
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				alert = err instanceof Error ? err.message : 'Sign-in could not be completed.';
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>Sign in · ShippinTECH</title>
</svelte:head>

<p>{alert || 'Signing in'}</p>
