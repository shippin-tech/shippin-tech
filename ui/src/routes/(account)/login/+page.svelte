<script lang="ts">
	import KeyNotice from '$lib/shippin/keys/KeyNotice.svelte';
	import { emailDomain } from '$lib/shippin/org/brand-call';
	import { beginSso, ssoOffered } from '$lib/shippin/org/sso';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authBody, postAuth, type AuthFields, type OAuthQuery } from '$lib/adapter/auth';
	import { requestDiscover } from '$lib/adapter/discover';
	import { rememberReturnPath } from '$lib/adapter/session';
	import Login from '$lib/catalog/login/Login.svelte';
	import type { LoginVariant } from '$lib/catalog/login/variants';
	import { loadPlan } from '$lib/adapter/panel';
	import { setupPending } from '$lib/adapter/setup';

	const params = page.url.searchParams;
	const device = /\/device(\/|$)/.test(page.url.pathname);
	const missingRedirect = !device && !params.get('redirect_uri');

	let variant = $state<LoginVariant>(device ? 'device' : missingRedirect ? 'account' : 'password');
	let title = $state(device ? 'Authorize device' : 'Sign in');
	let subtitle = $state(
		device
			? 'Sign in to approve this device.'
			: missingRedirect
				? 'Enter your email address to continue'
				: 'Enter your credentials to continue'
	);
	const ssoFailed = params.get('sso') === 'failed';
	let alert = $state(ssoFailed ? 'Your organisation sign-in did not work. Use your password, or ask your administrator.' : '');
	let alertKind = $state<'' | 'error' | 'success'>(ssoFailed ? 'error' : '');
	let ssoOffer = $state(false);
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

	let signupOpen = $state(false);
	// A new server with no administrator yet: say where its setup key goes.
	let setupOpen = $state(false);

	onMount(() => {
		rememberReturnPath(params.get('return'));
		loadPlan()
			.then((plan) => (signupOpen = plan.signup === 'open'))
			.catch(() => (signupOpen = false));
		setupPending()
			.then((open) => (setupOpen = open))
			.catch(() => (setupOpen = false));
	});

	$effect(() => {
		const domain = emailDomain(username);
		if (variant !== 'password' || !domain) {
			ssoOffer = false;
			return;
		}
		let current = true;
		void ssoOffered(domain).then((offered) => {
			if (current) ssoOffer = offered;
		});
		return () => {
			current = false;
		};
	});

	async function useSso() {
		if (!oauth.redirectUri) return;
		pending = true;
		alert = '';
		try {
			window.location.assign(
				await beginSso({
					account: username,
					clientId: oauth.clientId,
					redirectUri: oauth.redirectUri,
					nonce: oauth.nonce,
					scope: oauth.scope,
					codeChallenge: oauth.codeChallenge,
					codeChallengeMethod: oauth.codeChallengeMethod,
					state: oauth.state
				})
			);
		} catch (err) {
			alertKind = 'error';
			alert = err instanceof Error ? err.message : 'Your organisation sign-in could not be started.';
			pending = false;
		}
	}

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
				// Mailboxes sign in with their address; the server's own administrator
				// (the first-run "admin" or RECOVERY_ADMIN) has a plain name.
				if (!fields.username.trim()) {
					alertKind = 'error';
					alert = 'Enter your email address, or admin for the server administrator.';
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
	onsso={ssoOffer ? useSso : undefined}
	bind:username
	bind:deviceCode
	{onsubmit}
/>

{#if setupOpen && !device}
	<KeyNotice variant="setup" />
{/if}
{#if params.get('admin') === '1'}
	<p class="closed" role="status">Your administrator was created and the setup key no longer works. Sign in with your new address.</p>
{/if}
{#if params.get('closed') === '1'}
	<p class="closed" role="status">Your domain was closed and its mail deleted.</p>
{/if}
{#if !device}
	<details class="forgot">
		<summary>Forgot your password?</summary>
		<p>Ask the owner of your domain. They can set a new password for your mailbox under My domain.</p>
	</details>
{/if}
{#if signupOpen && !device}
	<p class="signup-link">New here? <a href="/signup">Create a free mail account</a> for your domain.</p>
{/if}

<style>
	.signup-link { text-align: center; margin-block: var(--space-3); color: var(--color-muted); }
	.closed { max-inline-size: 26rem; margin: var(--space-3) auto 0; text-align: center; }
	.forgot { max-inline-size: 26rem; margin: var(--space-3) auto 0; color: var(--color-muted); }
	.forgot summary { cursor: pointer; text-align: center; }
	.forgot p { margin: var(--space-2) 0 0; }
</style>
