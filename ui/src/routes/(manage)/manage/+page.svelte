<script lang="ts">
	import { onMount } from 'svelte';
	import DomainManager from '$lib/catalog/panel/DomainManager.svelte';
	import LogoEditor from '$lib/shippin/org/LogoEditor.svelte';
	import { removeLogo, uploadLogo } from '$lib/shippin/org/brand';
	import SsoEditor from '$lib/shippin/org/SsoEditor.svelte';
	import { clearSso, loadSso, saveSso } from '$lib/shippin/org/sso';
	import ProvisioningEditor from '$lib/shippin/org/ProvisioningEditor.svelte';
	import { loadProvisioning, makeProvisioningToken, revokeProvisioningToken } from '$lib/shippin/org/provisioning';
	import {
		PanelError,
		addAlias,
		closeDomain,
		createMailbox,
		deleteMailbox,
		loadDnsStatus,
		loadDomain,
		loadMailboxes,
		removeAlias,
		setCatchAll,
		setMailboxPassword
	} from '$lib/adapter/panel';
	import type { DnsCheck, DomainView, Mailbox } from '$lib/panel/model';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import { account } from '$lib/adapter/session';
	import { goto } from '$app/navigation';
	import { clearSession } from '$lib/adapter/session';
	import { forgetRole } from '$lib/adapter/home';

	let view = $state<DomainView | null>(null);
	let mailboxes = $state<Mailbox[]>([]);
	let checks = $state<DnsCheck[] | null>(null);

	async function recheck() {
		checks = await loadDnsStatus();
		if (view && checks.length > 0 && checks.every((check) => check.state === 'found')) {
			mcplEmit('panel.dns.published', view.domain, { records: checks.length });
		}
	}

	const lesson = LESSONS.find((item) => item.id === 'set-up-your-domain')!;
	const who = account()?.username ?? '';
	let progress = $state(loadProgress(who, lesson));
	$effect(() => {
		$lessonsChanged;
		progress = loadProgress(who, lesson);
	});
	function dismissLesson() {
		progress = { ...progress, dismissed: true };
		saveProgress(who, lesson, progress);
		void pushLessonProgress(lesson.id, progress);
	}
	let phase = $state<'pending' | 'ready' | 'not-owner' | 'error'>('pending');
	let problem = $state('');

	async function refresh() {
		const [nextView, nextMailboxes] = await Promise.all([loadDomain(), loadMailboxes()]);
		view = nextView;
		mailboxes = nextMailboxes;
		phase = 'ready';
		// DNS lookups can be slow; the page shows without waiting for them.
		recheck().catch(() => (checks = []));
	}

	onMount(() => {
		refresh().catch((err) => {
			if (err instanceof PanelError && err.code === 'notOwner') phase = 'not-owner';
			else if (err instanceof PanelError && err.code === 'signedOut') return;
			else {
				phase = 'error';
				problem = err instanceof Error ? err.message : 'The domain could not be loaded.';
			}
		});
	});

	const after = <T,>(task: Promise<T>) => task.then(refresh);
</script>

<svelte:head><title>{view ? view.domain : 'My domain'}</title></svelte:head>

{#if phase === 'pending'}
	<p class="note">Loading…</p>
{:else if phase === 'not-owner'}
	<section class="note">
		<h1>No domain on this account</h1>
		<p>This mailbox does not manage a domain. Ask the domain owner for changes, or <a href="/mail">open your mail</a>.</p>
	</section>
{:else if phase === 'error'}
	<p class="note" role="alert">{problem}</p>
{:else if view}
	<div class="lesson-slot"><Lesson {lesson} {progress} ondismiss={dismissLesson} /></div>
	{#snippet logo()}
		<LogoEditor
			domain={view!.domain}
			onupload={(domain, file) => uploadLogo(domain, file).then(() => mcplEmit('org.logo.changed', 'org'))}
			onremove={(domain) => removeLogo(domain).then(() => mcplEmit('org.logo.changed', 'org'))}
		/>
		<SsoEditor
			domain={view!.domain}
			onload={loadSso}
			onsave={(domain, draft) => saveSso(domain, draft).then(() => mcplEmit('org.sso.changed', 'org'))}
			onclear={(domain) => clearSso(domain).then(() => mcplEmit('org.sso.changed', 'org'))}
		/>
		<ProvisioningEditor
			domain={view!.domain}
			onload={loadProvisioning}
			onmake={(domain) => makeProvisioningToken(domain).then((made) => (mcplEmit('org.provisioning.changed', 'org'), made))}
			onrevoke={(domain) => revokeProvisioningToken(domain).then(() => mcplEmit('org.provisioning.changed', 'org'))}
		/>
	{/snippet}
	<DomainManager
		{logo}
		{view}
		{mailboxes}
		{checks}
		onrecheck={recheck}
		oncatchall={(mailbox) => after(setCatchAll(mailbox).then(() => mcplEmit('panel.catchall.changed', view!.domain, { enabled: mailbox !== '' })))}
		onclose={async () => {
			await closeDomain(view!.domain);
			mcplEmit('panel.domain.closed', view!.domain);
			// Leave /manage first: clearing the session while still here would trip the
			// sign-in gate, which sends people to plain /login and loses the message.
			await goto('/login?closed=1', { replaceState: true });
			clearSession();
			forgetRole();
		}}
		oncreate={(name, password) => after(createMailbox(name, password).then(() => mcplEmit('panel.mailbox.created', view!.domain)))}
		ondelete={(mailbox) => after(deleteMailbox(mailbox.id).then(() => mcplEmit('panel.mailbox.deleted', view!.domain)))}
		onpassword={(mailbox, password) => after(setMailboxPassword(mailbox.id, password))}
		onaddalias={(mailbox, alias) => after(addAlias(mailbox.id, alias).then(() => mcplEmit('panel.alias.created', view!.domain)))}
		onremovealias={(mailbox, alias) => after(removeAlias(mailbox.id, alias))}
	/>
{/if}

<style>
	.lesson-slot { max-inline-size: 72rem; margin: 0 auto var(--space-3); padding-inline: var(--space-3); }
	.note { max-inline-size: 40rem; margin-inline: auto; padding: var(--space-3); }
</style>
