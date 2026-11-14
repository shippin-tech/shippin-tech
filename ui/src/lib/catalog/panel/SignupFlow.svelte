<script lang="ts">
	import { passwordProblem, validDomain, validLocalPart, type PanelPlan, type VerifyRecord } from '$lib/panel/model';

	type Props = {
		plan: PanelPlan | null;
		planError?: string;
		onrequest: (domain: string) => Promise<{ domain: string; record: VerifyRecord; dnsProof: boolean }>;
		oncomplete: (domain: string, name: string, password: string) => Promise<{ email: string }>;
	};

	let { plan, planError = '', onrequest, oncomplete }: Props = $props();

	let step = $state<'domain' | 'verify' | 'done'>('domain');
	let domain = $state('');
	let record = $state<VerifyRecord | null>(null);
	let dnsProof = $state(true);
	let name = $state('admin');
	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let busy = $state(false);
	let email = $state('');
	let copied = $state('');

	async function start(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!validDomain(domain)) {
			error = 'Enter a domain name like example.com.';
			return;
		}
		busy = true;
		try {
			const result = await onrequest(domain.trim());
			domain = result.domain;
			record = result.record;
			dnsProof = result.dnsProof;
			step = 'verify';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	async function finish(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!validLocalPart(name)) {
			error = 'Use letters, digits, dots, dashes or underscores for the address.';
			return;
		}
		const weak = passwordProblem(password);
		if (weak) {
			error = weak;
			return;
		}
		if (password !== confirm) {
			error = 'The two passwords are different.';
			return;
		}
		busy = true;
		try {
			const result = await oncomplete(domain, name.trim(), password);
			email = result.email;
			password = '';
			confirm = '';
			step = 'done';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	async function copy(label: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = label;
			setTimeout(() => (copied = ''), 1500);
		} catch {
			copied = '';
		}
	}
</script>

<section class="signup" aria-labelledby="signup-title">
	<h1 id="signup-title">Create your free mail account</h1>

	{#if planError}
		<p class="alert" role="alert">{planError}</p>
	{:else if !plan}
		<p class="muted">Loading…</p>
	{:else if plan.signup === 'closed'}
		<p class="alert" role="status">Signups are closed on this server right now.</p>
	{:else}
		<p class="muted">
			Bring your own domain. The free plan includes {plan.mailboxes} mailboxes of {plan.mailboxMb >= 1024 ? `${plan.mailboxMb / 1024} GB` : `${plan.mailboxMb} MB`}
			each, {plan.aliases} aliases, and up to {plan.sendsPerDay} sent messages per mailbox per day.
		</p>
		{#if !plan.dnsProof}
			<p class="alert" role="alert">Domain ownership checks are turned off on this server. Use it for testing only.</p>
		{/if}

		<ol class="steps" aria-label="Signup steps">
			<li aria-current={step === 'domain' ? 'step' : undefined}>Your domain</li>
			<li aria-current={step === 'verify' ? 'step' : undefined}>Prove you own it</li>
			<li aria-current={step === 'done' ? 'step' : undefined}>Done</li>
		</ol>

		{#if step === 'domain'}
			<form onsubmit={start} novalidate>
				<label for="signup-domain">Domain</label>
				<input id="signup-domain" bind:value={domain} placeholder="example.com" autocomplete="off" autocapitalize="off" spellcheck="false" required />
				<button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
			</form>
		{:else if step === 'verify' && record}
			<div class="card">
				<p>Add this record at your DNS provider for <strong>{domain}</strong>. It proves you control the domain.</p>
				<dl class="record">
					<dt>Type</dt>
					<dd><code>{record.type}</code></dd>
					<dt>Host</dt>
					<dd>
						<code>{record.name.slice(0, -(domain.length + 1))}</code>
						<span class="muted">({record.name})</span>
						<button type="button" class="link" onclick={() => copy('host', record!.name.slice(0, -(domain.length + 1)))}>{copied === 'host' ? 'Copied' : 'Copy'}</button>
					</dd>
					<dt>Value</dt>
					<dd>
						<code class="value">{record.value}</code>
						<button type="button" class="link" onclick={() => copy('value', record!.value)}>{copied === 'value' ? 'Copied' : 'Copy'}</button>
					</dd>
				</dl>
				{#if !dnsProof}
					<p class="muted">Ownership checks are off here, so you can continue without adding it.</p>
				{/if}
			</div>
			<form onsubmit={finish} novalidate>
				<label for="signup-name">Your address</label>
				<div class="address">
					<input id="signup-name" bind:value={name} autocomplete="username" autocapitalize="off" spellcheck="false" required />
					<span>@{domain}</span>
				</div>
				<label for="signup-password">Password</label>
				<input id="signup-password" type="password" bind:value={password} autocomplete="new-password" required minlength="10" />
				<label for="signup-confirm">Repeat password</label>
				<input id="signup-confirm" type="password" bind:value={confirm} autocomplete="new-password" required minlength="10" />
				<div class="actions">
					<button type="button" class="secondary" onclick={() => ((step = 'domain'), (error = ''))} disabled={busy}>Back</button>
					<button type="submit" disabled={busy}>{busy ? 'Checking DNS…' : 'Verify and create'}</button>
				</div>
			</form>
		{:else if step === 'done'}
			<div class="card" role="status">
				<p><strong>{email}</strong> is ready.</p>
				<p class="muted">Sign in to add mailboxes and see the DNS records that make mail flow.</p>
				<a class="button" href="/login?login_hint={encodeURIComponent(email)}">Sign in</a>
			</div>
		{/if}

		{#if error}
			<p class="alert" role="alert">{error}</p>
		{/if}
	{/if}
	<p class="muted small">Already have an account? <a href="/login">Sign in</a></p>
</section>

<style>
	.signup { display: grid; gap: var(--space-3); max-inline-size: 40rem; margin-inline: auto; padding: var(--space-3); }
	h1 { margin: 0; }
	.muted { color: var(--color-muted); margin: 0; }
	.small { font-size: 0.9em; }
	.alert { margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-inline-start: 3px solid var(--brand-accent, #22d3ee); border-radius: var(--radius); background: var(--color-card); }
	.steps { display: flex; gap: var(--space-3); list-style: none; padding: 0; margin: 0; color: var(--color-muted); flex-wrap: wrap; }
	.steps li[aria-current='step'] { color: var(--color-text); font-weight: 600; }
	form { display: grid; gap: var(--space-2); }
	label { font-weight: 600; }
	input { font: inherit; min-height: 2.75rem; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); color: var(--color-text); }
	.address { display: flex; align-items: center; gap: var(--space-1); }
	.address input { flex: 1; min-inline-size: 0; }
	.card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.card p { margin: 0; }
	.record { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); margin: 0; }
	.record dt { color: var(--color-muted); }
	.record dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); min-inline-size: 0; }
	.value { overflow-wrap: anywhere; }
	.actions { display: flex; gap: var(--space-2); justify-content: flex-end; }
	button, .button { font: inherit; min-height: 2.75rem; padding: 0 var(--space-3); border-radius: var(--radius); border: 1px solid transparent; background: var(--color-accent); color: var(--color-accent-fg); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; justify-self: start; }
	button.secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
	button.link { min-height: auto; padding: 0 var(--space-1); background: transparent; color: var(--color-text); text-decoration: underline; border: 0; }
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
