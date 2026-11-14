<script lang="ts">
	import { onMount } from 'svelte';
	import { account } from '$lib/adapter/session';
	import { loadTls, type TlsReport } from '$lib/adapter/tls';
	import { executeAction } from '$lib/adapter/actions';
	import { certificateManagement, certificateNames, certificateStatus, tlsRecordUrl } from '$lib/portal/tls';

	let report = $state<TlsReport | null>(null);
	let busy = $state(false);
	let failed = $state(false);
	let notice = $state('');
	let signedOut = $state(false);
	let now = $state(Date.now());
	const canReload = $derived(report?.schema.schemas['x:Action']?.variants?.some((variant) => variant.name === 'ReloadTlsCertificates') === true);

	async function refresh() {
		if (busy) return;
		busy = true;
		failed = false;
		notice = '';
		try {
			report = await loadTls();
			now = Date.now();
		} catch (error) {
			failed = true;
			notice = error instanceof Error ? error.message : 'TLS settings could not be loaded.';
			if (notice === 'sign-in required') { signedOut = true; report = null; }
		} finally {
			busy = false;
		}
	}

	async function reloadCertificates() {
		if (busy || !canReload || !confirm('Reload TLS certificates on the server? This does not request a certificate or establish browser trust.')) return;
		busy = true;
		failed = false;
		notice = '';
		try {
			await executeAction('ReloadTlsCertificates', {});
			notice = 'The server confirmed the certificate reload. This does not verify the certificate served by your HTTPS endpoint.';
		} catch (error) {
			failed = true;
			notice = error instanceof Error ? error.message : 'Certificate reload failed.';
			if (notice === 'sign-in required') { signedOut = true; report = null; }
		} finally {
			busy = false;
		}
	}

	function challengeLabel(value: unknown): string {
		const name = report?.schema.fields['x:AcmeProvider']?.properties.challengeType?.type.enumName ?? '';
		const options = report?.schema.enums[name];
		return Array.isArray(options) ? options.find((option) => option.name === value)?.label ?? String(value ?? 'Not reported') : String(value ?? 'Not reported');
	}

	onMount(() => {
		if (!account()) { signedOut = true; return; }
		void refresh();
	});
</script>

<svelte:head><title>TLS certificates</title></svelte:head>

<article aria-busy={busy}>
	<header>
		<h1>TLS certificates</h1>
		<p>Manage certificate providers, automatic issuance for domains, and imported certificates from this panel.</p>
	</header>
	{#if signedOut}
		<p><a href="/login">Sign in</a> to manage TLS certificates.</p>
	{:else}
		<div class="actions">
			<button type="button" disabled={busy} onclick={refresh}>Refresh TLS settings</button>
			{#if canReload}<button type="button" disabled={busy} onclick={reloadCertificates}>Reload TLS certificates</button>{/if}
		</div>
		{#if notice}<p role={failed ? 'alert' : 'status'}>{notice}</p>{/if}
		{#if busy && !report}<p>Loading TLS settings...</p>{/if}
		<section aria-labelledby="tls-setup">
			<h2 id="tls-setup">Automatic certificates</h2>
			<ol>
				<li><a href={tlsRecordUrl('x:AcmeProvider')}>Create or edit an ACME provider</a>. Choose its directory, contact address and challenge type. Defaults and available choices come from this server.</li>
				<li><a href={tlsRecordUrl('x:Domain')}>Edit the hostname's domain</a>. Under TLS, select automatic certificate management and your ACME provider. Add any required certificate hostnames using the field's guidance.</li>
				<li>For TLS-ALPN-01, public TCP port 443 must reach this mail server directly. HTTP-01 needs public port 80; DNS challenges need the corresponding DNS setup.</li>
			</ol>
			<p>If HTTPS is still using an untrusted fallback certificate, this panel cannot repair the connection before its JavaScript loads. Access the loopback HTTP listener through an SSH tunnel for initial configuration; do not expose it publicly or disable certificate validation.</p>
			<p>Saving automatic management requests server-side issuance. Reloading certificates is not an issuance request. Registry records and validity dates do not prove that the browser trusts the certificate served for this hostname.</p>
		</section>
		{#if report}
			<section aria-labelledby="tls-providers">
				<h2 id="tls-providers">ACME providers</h2>
				<a href={tlsRecordUrl('x:AcmeProvider')}>Manage ACME providers</a>
				{#if report.providers.length}
					<div class="table"><table>
						<thead><tr><th scope="col">Provider</th><th scope="col">Directory</th><th scope="col">Challenge</th></tr></thead>
						<tbody>{#each report.providers as provider (String(provider.id))}
							<tr><th scope="row"><a href={tlsRecordUrl('x:AcmeProvider', String(provider.id))}>{String(provider.description ?? provider.id)}</a></th><td>{String(provider.directory ?? 'Not reported')}</td><td>{challengeLabel(provider.challengeType)}</td></tr>
						{/each}</tbody>
					</table></div>
				{:else}<p>No ACME providers configured.</p>{/if}
			</section>
			<section aria-labelledby="tls-domains">
				<h2 id="tls-domains">Domain certificate management</h2>
				<a href={tlsRecordUrl('x:Domain')}>Manage domains</a>
				{#if report.domains.length}
					<div class="table"><table>
						<thead><tr><th scope="col">Domain</th><th scope="col">Certificate management</th></tr></thead>
						<tbody>{#each report.domains as domain (String(domain.id))}
							<tr><th scope="row"><a href={tlsRecordUrl('x:Domain', String(domain.id))}>{String(domain.name ?? domain.id)}</a></th><td>{certificateManagement(domain.certificateManagement, report.providers)}</td></tr>
						{/each}</tbody>
					</table></div>
				{:else}<p>No domains configured.</p>{/if}
			</section>
			<section aria-labelledby="tls-certificates">
				<h2 id="tls-certificates">Stored certificates</h2>
				<a href={tlsRecordUrl('x:Certificate')}>Import or edit certificates</a>
				<p>Paste your certificate chain and private key into their respective fields in the certificate editor. Never put a private key in a URL or chat.</p>
				{#if report.certificates.length}
					<div class="table"><table>
						<thead><tr><th scope="col">Hostnames</th><th scope="col">Issuer</th><th scope="col">Expires</th><th scope="col">Validity</th></tr></thead>
						<tbody>{#each report.certificates as certificate (String(certificate.id))}
							<tr><th scope="row"><a href={tlsRecordUrl('x:Certificate', String(certificate.id))}>{certificateNames(certificate.subjectAlternativeNames)}</a></th><td>{String(certificate.issuer ?? 'Not reported')}</td><td>{String(certificate.notValidAfter ?? 'Not reported')}</td><td>{certificateStatus(certificate, now)}</td></tr>
						{/each}</tbody>
					</table></div>
				{:else}<p>No certificates stored. The server may still be serving its self-signed fallback certificate.</p>{/if}
			</section>
		{/if}
	{/if}
</article>

<style>
	article, section { display: grid; gap: var(--space-3); }
	section { border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-3); }
	h1, h2, p { margin: 0; }
	header p, td { color: var(--color-muted); }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	button { background: var(--color-card); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-2); font: inherit; }
	li + li { margin-block-start: var(--space-2); }
	.table { overflow-x: auto; }
	table { inline-size: 100%; border-collapse: collapse; }
	th, td { text-align: start; vertical-align: top; padding: var(--space-2); border-block-end: 1px solid var(--color-border); overflow-wrap: anywhere; }
</style>
