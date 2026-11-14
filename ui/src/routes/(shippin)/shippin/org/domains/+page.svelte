<script lang="ts">
	import { onMount } from 'svelte';
	import OrgDomains from '$lib/shippin/org/OrgDomains.svelte';
	import LogoEditor from '$lib/shippin/org/LogoEditor.svelte';
	import SsoEditor from '$lib/shippin/org/SsoEditor.svelte';
	import ProvisioningEditor from '$lib/shippin/org/ProvisioningEditor.svelte';
	import { loadMyOrg, loadOrgDns, type MyOrg, type OrgDns, type OrgDomain } from '$lib/shippin/org/orgs';
	import { removeLogo, uploadLogo } from '$lib/shippin/org/brand';
	import { clearSso, loadSso, saveSso } from '$lib/shippin/org/sso';
	import { loadProvisioning, makeProvisioningToken, revokeProvisioningToken } from '$lib/shippin/org/provisioning';
	import { mcplEmit } from '$lib/mcpl/events';

	let org = $state<MyOrg | null>(null);
	let dns = $state<Record<string, OrgDns | undefined>>({});
	let notice = $state('Loading domains.');

	async function check(domain: OrgDomain) {
		try {
			dns = { ...dns, [domain.id]: await loadOrgDns(domain.id) };
		} catch (err) {
			notice = err instanceof Error ? err.message : 'DNS could not be checked.';
		}
	}

	onMount(async () => {
		try {
			org = await loadMyOrg();
			notice = '';
			await Promise.all(org.domains.map(check));
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Domains could not be loaded.';
		}
	});
</script>

<svelte:head><title>Domains</title></svelte:head>

<OrgDomains {org} {dns} {notice} oncheck={check}>
	{#snippet settings(domain: OrgDomain)}
		<LogoEditor
			domain={domain.name}
			onupload={(name, file) => uploadLogo(name, file).then(() => mcplEmit('org.logo.changed', 'org'))}
			onremove={(name) => removeLogo(name).then(() => mcplEmit('org.logo.changed', 'org'))}
		/>
		<SsoEditor
			domain={domain.name}
			onload={loadSso}
			onsave={(name, draft) => saveSso(name, draft).then(() => mcplEmit('org.sso.changed', 'org'))}
			onclear={(name) => clearSso(name).then(() => mcplEmit('org.sso.changed', 'org'))}
		/>
		<ProvisioningEditor
			domain={domain.name}
			onload={loadProvisioning}
			onmake={(name) => makeProvisioningToken(name).then((made) => (mcplEmit('org.provisioning.changed', 'org'), made))}
			onrevoke={(name) => revokeProvisioningToken(name).then(() => mcplEmit('org.provisioning.changed', 'org'))}
		/>
	{/snippet}
</OrgDomains>
