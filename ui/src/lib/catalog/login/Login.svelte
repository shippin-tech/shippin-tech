<script lang="ts">
	import type { LoginVariant } from './variants';

	type Fields = {
		username: string;
		password: string;
		deviceCode: string;
		otp: string;
	};

	type Props = {
		variant: LoginVariant;
		title: string;
		subtitle: string;
		alert: string;
		alertKind: '' | 'error' | 'success';
		pending: boolean;
		closed?: boolean;
		submitLabel?: string;
		username?: string;
		deviceCode?: string;
		onsubmit: (fields: Fields) => void;
	};

	let {
		variant,
		title,
		subtitle,
		alert,
		alertKind,
		pending,
		closed = false,
		submitLabel = 'Sign in',
		username = $bindable(''),
		deviceCode = $bindable(''),
		onsubmit
	}: Props = $props();

	let password = $state('');
	let otp = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit({ username, password, deviceCode, otp });
	}

	function onOtp(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		otp = input.value.replace(/\D/g, '').slice(0, 6);
		if (otp.length === 6) onsubmit({ username, password, deviceCode, otp });
	}
</script>

<form class="card" onsubmit={submit} novalidate>
	<p class="brand">shippin</p>
	<h1>{title}</h1>
	<p class="sub">{subtitle}</p>
	{#if alert}
		<p class="alert" class:success={alertKind === 'success'} role="status">{alert}</p>
	{/if}
	{#if !closed}
	{#if variant !== 'otp'}
		<label>
			Username
			<input name="username" type="text" autocomplete="username" bind:value={username} required />
		</label>
		<label>
			Password
			<input name="password" type="password" autocomplete="current-password" bind:value={password} required />
		</label>
	{/if}
	{#if variant === 'device'}
		<label>
			Device code
			<input name="device-code" type="text" autocomplete="off" bind:value={deviceCode} />
		</label>
	{/if}
	{#if variant === 'otp'}
		<label>
			One-time code
			<input name="otp" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" value={otp} oninput={onOtp} />
		</label>
	{/if}
	<button type="submit" disabled={pending}>{pending ? 'Signing in' : submitLabel}</button>
	{/if}
</form>

<style>
	.card {
		display: grid;
		gap: var(--space-3);
		width: min(24rem, 100%);
		margin: var(--space-4) auto;
		padding: var(--space-4);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
	}
	.brand {
		margin: 0;
		color: var(--color-brand);
		font-weight: 650;
	}
	h1,
	.sub,
	.alert {
		margin: 0;
	}
	.sub {
		color: var(--color-muted);
	}
	.alert {
		color: var(--color-danger);
	}
	.alert.success {
		color: var(--color-success);
	}
	label {
		display: grid;
		gap: var(--space-1);
		font-size: 0.9rem;
	}
	input,
	button {
		font: inherit;
		border-radius: var(--radius);
		transition: transform var(--motion-duration) var(--motion-ease);
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
	button:hover {
		transform: translateY(calc(var(--motion-distance) * -1));
	}
</style>
