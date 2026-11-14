<script lang="ts">
	import { onMount } from 'svelte';
	import OrgsPortal from '$lib/shippin/org/OrgsPortal.svelte';
	import LessonFor from '$lib/shippin/LessonFor.svelte';
	import { loadOrgs, removeOrg, saveOrg, type OrgDomain, type OrgDraft, type Organisation } from '$lib/shippin/org/orgs';
	import { removeLogo, uploadLogo } from '$lib/shippin/org/brand';
	import SsoEditor from '$lib/shippin/org/SsoEditor.svelte';
	import { clearSso, loadSso, saveSso } from '$lib/shippin/org/sso';
	import ProvisioningEditor from '$lib/shippin/org/ProvisioningEditor.svelte';
	import { loadProvisioning, makeProvisioningToken, revokeProvisioningToken } from '$lib/shippin/org/provisioning';
	import { mcplEmit } from '$lib/mcpl/events';

	let orgs = $state<Organisation[]>([]);
	let domains = $state<OrgDomain[]>([]);
	let notice = $state('Loading organisations.');
	let problem = $state('');

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	async function load() {
		try {
			({ orgs, domains } = await loadOrgs());
			domains = domains.sort((a, b) => a.name.localeCompare(b.name));
			notice = '';
		} catch (err) {
			notice = message(err, 'Organisations could not be loaded.');
		}
	}

	onMount(load);

	async function save(draft: OrgDraft): Promise<boolean> {
		problem = '';
		try {
			await saveOrg(draft);
			mcplEmit('org.saved', 'org');
			await load();
			return true;
		} catch (err) {
			problem = message(err, 'The organisation could not be saved.');
			return false;
		}
	}

	async function remove(org: Organisation) {
		problem = '';
		try {
			await removeOrg(org.id);
			mcplEmit('org.removed', 'org');
			await load();
		} catch (err) {
			problem = message(err, 'The organisation could not be removed.');
		}
	}
</script>

<svelte:head><title>Organisations</title></svelte:head>

<LessonFor id="set-up-an-organisation" />
<OrgsPortal
	{orgs}
	{domains}
	{notice}
	{problem}
	onsave={save}
	onremove={remove}
	onlogo={(domain, file) => uploadLogo(domain, file).then(() => mcplEmit('org.logo.changed', 'org'))}
	onlogoremove={(domain) => removeLogo(domain).then(() => mcplEmit('org.logo.changed', 'org'))}
>
	{#snippet sso(domain: string)}
		<SsoEditor
			{domain}
			onload={loadSso}
			onsave={(name, draft) => saveSso(name, draft).then(() => mcplEmit('org.sso.changed', 'org'))}
			onclear={(name) => clearSso(name).then(() => mcplEmit('org.sso.changed', 'org'))}
		/>
		<ProvisioningEditor
			{domain}
			onload={loadProvisioning}
			onmake={(name) => makeProvisioningToken(name).then((made) => (mcplEmit('org.provisioning.changed', 'org'), made))}
			onrevoke={(name) => revokeProvisioningToken(name).then(() => mcplEmit('org.provisioning.changed', 'org'))}
		/>
	{/snippet}
</OrgsPortal>
