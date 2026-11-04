<script lang="ts">
	import { page } from '$app/state';
	import { authBody, postAuth, type AuthFields, type OAuthQuery } from '$lib/adapter/auth';
	import Login from '$lib/catalog/login/Login.svelte';
	import type { LoginVariant } from '$lib/catalog/login/variants';

	const params = page.url.searchParams;
	const device = /\/device(\/|$)/.test(page.url.pathname);
	const missingRedirect = !device && !params.get('redirect_uri');

	let variant = $state<LoginVariant>(device ? 'device' : 'password');
	let title = $state(device ? 'Authorize device' : missingRedirect ? 'Sign in with an app' : 'Sign in');
	let subtitle = $state(
		device
			? 'Sign in to approve this device.'
			: missingRedirect
				? 'This page is opened automatically by your mail, calendar or contacts app to authorize access to your account.'
				: 'Enter your credentials to continue'
	);
	let alert = $state(
		missingRedirect
			? 'This sign-in page cannot be used directly. Please start the sign-in from your app instead. (The required "redirect_uri" parameter is missing.)'
			: ''
	);
	let alertKind = $state<'' | 'error' | 'success'>(missingRedirect ? 'error' : '');
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
	let closed = $state(missingRedirect);

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

<Login {variant} {title} {subtitle} {alert} {alertKind} {pending} {closed} bind:username bind:deviceCode {onsubmit} />
