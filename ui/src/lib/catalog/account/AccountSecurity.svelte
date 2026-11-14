<script lang="ts">
	import KeyNotice from '$lib/shippin/keys/KeyNotice.svelte';
	import QRCode from 'qrcode';
	import { newSecret, otpauthUrl, verifyCode } from '$lib/account/totp';
	import { passwordProblem } from '$lib/panel/model';
	import type { AppPassword } from '$lib/adapter/account';

	type Props = {
		email: string;
		issuer: string;
		twoFactor: boolean;
		appPasswords: AppPassword[];
		onpassword: (current: string, next: string, code: string) => Promise<void>;
		onenable: (current: string, otpUrl: string) => Promise<void>;
		ondisable: (current: string, code: string) => Promise<void>;
		oncreateapp: (description: string) => Promise<string>;
		onrevokeapp: (item: AppPassword) => Promise<void>;
	};

	let { email, issuer, twoFactor, appPasswords, onpassword, onenable, ondisable, oncreateapp, onrevokeapp }: Props = $props();

	let message = $state('');
	let kind = $state<'error' | 'success'>('success');
	let busy = $state('');

	let current = $state('');
	let next = $state('');
	let repeat = $state('');
	let code = $state('');

	let setup = $state<{ secret: string; url: string; svg: string } | null>(null);
	let setupCode = $state('');
	let setupPassword = $state('');
	let offPassword = $state('');
	let offCode = $state('');

	let appName = $state('');
	let fresh = $state<{ name: string; secret: string } | null>(null);

	function say(next: 'error' | 'success', text: string) {
		kind = next;
		message = text;
	}

	async function run(key: string, task: () => Promise<void>) {
		busy = key;
		message = '';
		try {
			await task();
		} catch (err) {
			say('error', err instanceof Error ? err.message : 'Something went wrong.');
		} finally {
			busy = '';
		}
	}

	function changePassword(event: SubmitEvent) {
		event.preventDefault();
		const weak = passwordProblem(next);
		if (weak) return say('error', weak);
		if (next !== repeat) return say('error', 'The two new passwords are different.');
		if (twoFactor && !/^\d{6}$/.test(code.trim())) return say('error', 'Enter the 6-digit code from your authenticator app.');
		void run('password', async () => {
			await onpassword(current, next, twoFactor ? code.trim() : '');
			current = next = repeat = code = '';
			say('success', 'Your password was changed. Mail apps that use it need the new one.');
		});
	}

	async function startSetup() {
		const secret = newSecret();
		const url = otpauthUrl(issuer, email, secret);
		const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
		setup = { secret, url, svg };
		setupCode = '';
		setupPassword = '';
		message = '';
	}

	function finishSetup(event: SubmitEvent) {
		event.preventDefault();
		if (!setup) return;
		const pending = setup;
		void run('enable', async () => {
			if (!(await verifyCode(pending.secret, setupCode))) {
				throw new Error('That code does not match. Check the time on your phone and try the newest code.');
			}
			await onenable(setupPassword, pending.url);
			setup = null;
			setupCode = setupPassword = '';
			say('success', 'Two-factor sign-in is on. Mail apps now need an app password.');
		});
	}

	function turnOff(event: SubmitEvent) {
		event.preventDefault();
		void run('disable', async () => {
			await ondisable(offPassword, offCode.trim());
			offPassword = offCode = '';
			say('success', 'Two-factor sign-in is off.');
		});
	}

	function createApp(event: SubmitEvent) {
		event.preventDefault();
		const name = appName.trim();
		if (!name) return say('error', 'Name the app password so you can recognise it later, for example "Phone".');
		void run('app', async () => {
			const secret = await oncreateapp(name);
			fresh = { name, secret };
			appName = '';
		});
	}

	function revoke(item: AppPassword) {
		if (!confirm(`Revoke "${item.description}"? Any app using it will stop syncing.`)) return;
		void run(item.id, async () => {
			await onrevokeapp(item);
			say('success', `"${item.description}" was revoked.`);
		});
	}

	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			say('success', 'Copied.');
		} catch {
			say('error', 'Copy failed; select the text and copy it yourself.');
		}
	}

	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
</script>

<section class="account" aria-labelledby="account-title">
	<header>
		<h1 id="account-title">Account security</h1>
		<p class="muted">{email}</p>
	</header>

	{#if message}
		<p class="alert" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>{message}</p>
	{/if}

	<section aria-labelledby="password-title" class="card">
		<h2 id="password-title">Password</h2>
		<form onsubmit={changePassword} novalidate>
			<label for="pw-current">Current password</label>
			<input id="pw-current" type="password" autocomplete="current-password" bind:value={current} />
			<label for="pw-next">New password</label>
			<input id="pw-next" type="password" autocomplete="new-password" bind:value={next} />
			<label for="pw-repeat">Repeat new password</label>
			<input id="pw-repeat" type="password" autocomplete="new-password" bind:value={repeat} />
			{#if twoFactor}
				<label for="pw-code">Code from your authenticator app</label>
				<input id="pw-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} />
			{/if}
			<button type="submit" disabled={busy === 'password'}>{busy === 'password' ? 'Saving…' : 'Change password'}</button>
		</form>
	</section>

	<section aria-labelledby="mfa-title" class="card">
		<h2 id="mfa-title">Two-factor sign-in</h2>
		{#if twoFactor}
			<p>On. Signing in asks for a code from your authenticator app.</p>
			<form onsubmit={turnOff} novalidate>
				<label for="off-password">Current password</label>
				<input id="off-password" type="password" autocomplete="current-password" bind:value={offPassword} />
				<label for="off-code">Current code</label>
				<input id="off-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={offCode} />
				<button type="submit" class="danger" disabled={busy === 'disable'}>Turn off</button>
			</form>
		{:else if setup}
			<p>Scan this with an authenticator app, such as Google Authenticator, 1Password or Aegis. Then enter the code it shows.</p>
			<div class="qr" aria-hidden="true">{@html setup.svg}</div>
			<p class="muted">Can't scan? Enter this key by hand: <code class="secret">{setup.secret}</code> <button type="button" class="link" onclick={() => copy(setup!.secret)}>Copy</button></p>
			<form onsubmit={finishSetup} novalidate>
				<label for="setup-code">Code from the app</label>
				<input id="setup-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={setupCode} />
				<label for="setup-password">Current password</label>
				<input id="setup-password" type="password" autocomplete="current-password" bind:value={setupPassword} />
				<div class="actions">
					<button type="button" class="secondary" onclick={() => (setup = null)}>Cancel</button>
					<button type="submit" disabled={busy === 'enable'}>{busy === 'enable' ? 'Checking…' : 'Turn on'}</button>
				</div>
			</form>
		{:else}
			<p>Off. Turn it on so a stolen password alone cannot open your mail.</p>
			<button type="button" onclick={startSetup}>Set up two-factor sign-in</button>
		{/if}
	</section>

	<section aria-labelledby="apps-title" class="card">
		<h2 id="apps-title">App passwords</h2>
		<p class="muted">Use one in a mail app (phone, Outlook, Thunderbird) instead of your real password. You can revoke each one on its own. With two-factor on, mail apps need one.</p>
		{#if fresh}
			<div class="fresh" role="status">
				<p>New app password for <strong>{fresh.name}</strong>. Copy it now; it will not be shown again.</p>
				<p><code class="secret">{fresh.secret}</code> <button type="button" class="link" onclick={() => copy(fresh!.secret)}>Copy</button></p>
				<KeyNotice variant="app-password" />
				<button type="button" class="secondary" onclick={() => (fresh = null)}>Done</button>
			</div>
		{/if}
		{#if appPasswords.length > 0}
			<ul class="apps">
				{#each appPasswords as item (item.id)}
					<li>
						<span><strong>{item.description || 'Unnamed'}</strong> <span class="muted">{when(item.createdAt)}</span></span>
						<button type="button" class="danger" disabled={busy === item.id} onclick={() => revoke(item)}>Revoke</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">None yet.</p>
		{/if}
		<form onsubmit={createApp} class="inline" novalidate>
			<label for="app-name">Name</label>
			<input id="app-name" bind:value={appName} placeholder="Phone" />
			<button type="submit" disabled={busy === 'app'}>Create app password</button>
		</form>
	</section>
</section>

<style>
	.account { display: grid; gap: var(--space-4); max-inline-size: 44rem; margin-inline: auto; padding: var(--space-3); }
	header h1 { margin: 0; }
	h2 { margin: 0 0 var(--space-2); }
	.muted { color: var(--color-muted); margin: 0; }
	.card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.card p { margin: 0; }
	form { display: grid; gap: var(--space-2); max-inline-size: 26rem; }
	form.inline { grid-template-columns: auto 1fr auto; align-items: center; max-inline-size: none; }
	label { font-weight: 600; }
	input { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg, transparent); color: var(--color-text); min-inline-size: 0; }
	.alert { margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-inline-start: 3px solid var(--green, #16a34a); border-radius: var(--radius); background: var(--color-card); }
	.alert[data-kind='error'] { border-inline-start-color: var(--color-danger); }
	.qr { inline-size: 12rem; background: #fff; padding: var(--space-1); border-radius: var(--radius); }
	.qr :global(svg) { display: block; inline-size: 100%; block-size: auto; }
	.secret { overflow-wrap: anywhere; font-size: 1.05em; letter-spacing: 0.04em; }
	.fresh { display: grid; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px dashed var(--color-border); border-radius: var(--radius); }
	.apps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); }
	.apps li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; border-block-end: 1px solid var(--color-border); }
	.actions { display: flex; gap: var(--space-2); }
	button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-3); border-radius: var(--radius); border: 1px solid transparent; background: var(--color-accent); color: var(--color-accent-fg); cursor: pointer; justify-self: start; }
	button.secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
	button.danger { background: transparent; color: var(--color-danger); border-color: var(--color-danger); }
	button.link { min-height: auto; padding: 0 var(--space-1); background: transparent; color: var(--color-text); text-decoration: underline; border: 0; }
	button:disabled { opacity: 0.6; cursor: progress; }
	@media (max-width: 36rem) { form.inline { grid-template-columns: 1fr; } }
</style>
