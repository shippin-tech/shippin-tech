<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Portal from '$lib/shippin/admin/AdminShell.svelte';
	import AgentBar from '$lib/shippin/agent/AgentBar.svelte';
	import BootstrapWizard from '$lib/shippin/admin/BootstrapWizard.svelte';
	import SetupAdmin from '$lib/shippin/admin/SetupAdmin.svelte';
	import { createAdministrator, setupPending } from '$lib/adapter/setup';
	import { clearSession } from '$lib/adapter/session';
	import { forgetRole } from '$lib/adapter/home';
	import { goto } from '$app/navigation';
	import { mcplEmit } from '$lib/mcpl/events';
	import { completeBootstrap, loadBootstrap } from '$lib/adapter/bootstrap';
	import { account } from '$lib/adapter/session';
	import { valuesFromRecord, wizardFromGet } from '$lib/portal/bootstrap';
	import { bootstrap } from '$lib/portal/catalog';
	import { bindScriptedSignals } from '$lib/adapter/signal';

	let { children } = $props();
	const active = $derived(page.params.view ?? '');
	let wizard = $state(false);
	// Signed in with the first-run key: nothing else is shown until the real
	// administrator exists.
	let firstRun = $state(false);
	let values = $state<Record<string, string | boolean>>({});
	let ready = $state(false);
	let loadError = $state('');

	onMount(() => {
		const unbindSignals = bindScriptedSignals();
		if (!account()) {
			ready = true;
			return () => {
				unbindSignals();
			};
		}
		setupPending()
			.then((pending) => (firstRun = pending))
			.catch(() => (firstRun = false));
		loadBootstrap()
			.then((list) => {
				ready = true;
				if (wizardFromGet(list) !== 'wizard') return;
				const record = list[0];
				if (!record) return;
				values = valuesFromRecord(bootstrap.steps, record);
				wizard = true;
			})
			.catch((error) => {
				ready = true;
				loadError = error instanceof Error ? error.message : 'Failed to load setup state.';
				wizard = false;
			});
		return () => {
			unbindSignals();
		};
	});

	function onchange(name: string, value: string | boolean) {
		values = { ...values, [name]: value };
	}

	function onfinish() {
		return completeBootstrap(bootstrap.steps, values);
	}
</script>

{#if firstRun}
	<SetupAdmin
		oncreate={async (email, password) => {
			const created = await createAdministrator(email, password);
			mcplEmit('setup.administrator.created', created);
			// Leave the portal before clearing the session, or the sign-in gate wins the race.
			await goto(`/login?login_hint=${encodeURIComponent(created)}&admin=1`, { replaceState: true });
			clearSession();
			forgetRole();
		}}
	/>
{:else if wizard}
	<BootstrapWizard {values} {onchange} {onfinish} {ready} {loadError} />
{:else}
	<Portal {active}>
		{@render children()}
	</Portal>
	{#if account()}<AgentBar />{/if}
{/if}
