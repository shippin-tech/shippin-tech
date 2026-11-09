<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authBody, postAuth, type AuthFields, type OAuthQuery } from '$lib/adapter/auth';
	import { requestDiscover } from '$lib/adapter/discover';
	import { rememberReturnPath } from '$lib/adapter/session';
	import Login from '$lib/catalog/login/Login.svelte';
	import type { LoginVariant } from '$lib/catalog/login/variants';

	const params = page.url.searchParams;
	const device = /\/device(\/|$)/.test(page.url.pathname);
	const missingRedirect = !device && !params.get('redirect_uri');

	let variant = $state<LoginVariant>(device ? 'device' : missingRedirect ? 'account' : 'password');
	let title = $state(device ? 'Authorize device' : 'Sign in');
	let subtitle = $state(
		device
			? 'Sign in to approve this device.'
			: missingRedirect
				? 'Enter your account name to continue'
				: 'Enter your credentials to continue'
	);
	let alert = $state('');
	let alertKind = $state<'' | 'error' | 'success'>('');
	let pending = $state(false);
	let username = $state(params.get('login_hint') ?? '');
	let deviceCode = $state(device ? (params.get('code') ?? '') : '');
	let last = $state<AuthFields | null>(null);
	let oauth = $state<OAuthQuery>({
		clientId: params.get('client_id') || '',
		redirectUri: params.get('redirect_uri'),
		scope: params.get('scope'),
		state: params.get('state'),
		nonce: params.get('nonce'),
		codeChallenge: params.get('code_challenge'),
		codeChallengeMethod: params.get('code_challenge_method'),
		resource: params.getAll('resource')
	});
	let closed = $state(false);

	onMount(() => {
		rememberReturnPath(params.get('return'));
	});

	const failure = 'Temporary server failure. If the problem persists, contact your administrator.';

	function redirect(code: string, issuer?: string) {
		if (!oauth.redirectUri) {
			alertKind = 'error';
			alert = failure;
			return;
		}
		const target = new URL(oauth.redirectUri);
		target.searchParams.set('code', code);
		if (oauth.state) target.searchParams.set('state', oauth.state);
		target.searchParams.set('iss', issuer || window.location.origin);
		window.location.assign(target.toString());
	}

	async function onsubmit(fields: AuthFields) {
		if (closed) return;
		if (missingRedirect) {
			if (variant === 'account') {
				if (!fields.username.includes('@')) {
					alertKind = 'error';
					alert = 'Enter your account name to continue';
					return;
				}
				pending = true;
				alert = '';
				try {
					const next = await requestDiscover(fields.username);
					if (next.step !== 'redirect') {
						alertKind = 'error';
						alert = next.step === 'unconfigured' ? next.message : 'Sign-in could not be completed.';
						return;
					}
					for (const [key, value] of Object.entries(next.store)) {
						sessionStorage.setItem(key, value);
					}
					window.location.assign(next.url);
					return;
				} catch (err) {
					alertKind = 'error';
					alert = err instanceof Error ? err.message : 'Discovery failed';
				} finally {
					pending = false;
				}
				return;
			}
		}
		if (variant === 'otp') {
			if (!fields.otp || !last) {
				variant = device ? 'device' : 'password';
				alertKind = 'error';
				alert = 'Session expired. Please sign in again.';
				return;
			}
			fields = { ...last, otp: fields.otp };
		} else {
			if (!fields.username || !fields.password) {
				alertKind = 'error';
				alert = 'Please enter your username and password.';
				return;
			}
			if (device && !fields.deviceCode.trim()) {
				alertKind = 'error';
				alert = 'Please enter the device code.';
				return;
			}
			last = fields;
		}
		pending = true;
		alert = '';
		try {
			const resp = await postAuth(authBody(fields, oauth, device));
			if (resp.type === 'authenticated' && typeof resp.client_code === 'string') {
				redirect(resp.client_code, resp.iss);
				return;
			}
			if (resp.type === 'verified') {
				title = 'Device authorized';
				subtitle = 'You have successfully authorized this device. You may now close this window.';
				alertKind = 'success';
				alert = 'Device verified.';
				return;
			}
			if (resp.type === 'mfaRequired') {
				variant = 'otp';
				title = 'One-time code';
				subtitle = 'Enter the code from your authenticator.';
				return;
			}
			if (resp.type === 'failure') {
				variant = device ? 'device' : 'password';
				title = device ? 'Authorize device' : 'Sign in';
				subtitle = device ? 'Sign in to approve this device.' : 'Enter your credentials to continue';
				alertKind = 'error';
				alert = 'Invalid username or password. Please try again.';
				return;
			}
			alertKind = 'error';
			alert = failure;
		} catch {
			alertKind = 'error';
			alert = failure;
		} finally {
			pending = false;
		}
	}
</script>

<Login
	{variant}
	{title}
	{subtitle}
	{alert}
	{alertKind}
	{pending}
	{closed}
	submitLabel={variant === 'account' ? 'Continue' : 'Sign in'}
	bind:username
	bind:deviceCode
	{onsubmit}
/>
