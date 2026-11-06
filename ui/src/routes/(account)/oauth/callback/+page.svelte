<script lang="ts">
	import { goto } from '$app/navigation';
	import { exchangeAuthorizationCode } from '$lib/adapter/oauth';

	let alert = $state('');

	$effect(() => {
		let cancelled = false;
		exchangeAuthorizationCode()
			.then(() => {
				if (!cancelled) goto('/portal');
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
	<title>Sign in · shippin</title>
</svelte:head>

<p>{alert || 'Signing in'}</p>
