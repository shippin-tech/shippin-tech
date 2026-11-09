<script lang="ts">
	import { configureSignalWebhook, publishSignals } from '$lib/adapter/signal';
	import { createSignal } from '$lib/portal/signal';
	import {
		SERVICE_TIERS,
		controlPlanTemplate,
		projectNameFor,
		serviceTier,
		tierGate,
		type DeploymentRequest,
		type ServiceTierId
	} from '$lib/platform/control-plan';

	let {
		blueprint = 'mail',
		blueprintLabel = 'Managed Mail Core'
	}: {
		blueprint?: string;
		blueprintLabel?: string;
	} = $props();

	const template = controlPlanTemplate();
	const laneOptions = template.lanes;

	let mode = $state<'managed' | 'self-host'>('managed');
	let tier = $state<ServiceTierId>('free');
	let lane = $state(laneOptions[0]?.id ?? 'dedicated_stack_per_client');
	let tenant = $state('shippintech');
	let environment = $state('prod');
	let domain = $state('mail.example.org');
	let targetHost = $state('host-a');
	let workspaceEnabled = $state(true);
	let postgresDatabases = $state(1);
	let storageGb = $state(5);
	let activeProjects = $state(1);
	let webhook = $state('');
	let webhookNotice = $state('');
	let notice = $state('');

	const projectName = $derived(projectNameFor({ lane, tenant, environment }));
	const selectedLane = $derived(laneOptions.find((item) => item.id === lane));
	const selectedTier = $derived(serviceTier(tier));
	const preview = $derived<DeploymentRequest>({
		blueprint,
		mode,
		tier,
		lane,
		projectName,
		tenant,
		environment,
		domain,
		targetHost,
		workspaceEnabled,
		postgresDatabases,
		storageGb,
		activeProjects
	});
	const gate = $derived(tierGate(preview));

	function applyWebhook() {
		const result = configureSignalWebhook(webhook.trim() ? webhook : null);
		webhookNotice = result.ok ? 'Webhook destination saved.' : result.message ?? 'Webhook destination is invalid.';
	}

	function submit() {
		if (!gate.allowed) {
			publishSignals([
				createSignal({
					channel: 'scripted',
					source: 'scripted-ai',
					eventType: 'deploy.request.blocked',
					resource: 'platform-control',
					status: gate.requiresPause ? 'cancelled' : 'failed',
					severity: 'warn',
					payload: { preview, gate }
				})
			]);
			notice = gate.requiresPause
				? `Request paused for ${selectedTier.label}: ${gate.violations.join(' ')}`
				: `Request blocked: ${gate.violations.join(' ')}`;
			return;
		}
		publishSignals([
			createSignal({
				channel: 'scripted',
				source: 'scripted-ai',
				eventType: 'deploy.request.submitted',
				resource: 'platform-control',
				status: 'pending',
				severity: 'info',
				payload: preview
			})
		]);
		notice = `Deployment request queued for ${blueprintLabel} (${projectName}).`;
	}
</script>

<section class="planner">
	<h2>Deployment planner</h2>
	<p>Use this to standardize managed or self-host deployment requests before orchestration executes.</p>
	<div class="grid">
		<label>
			Blueprint
			<input type="text" value={blueprintLabel} disabled />
		</label>
		<label>
			Mode
			<select bind:value={mode}>
				<option value="managed">Managed by Shippin</option>
				<option value="self-host">Customer self-hosted</option>
			</select>
		</label>
		<label>
			Service tier
			<select bind:value={tier}>
				{#each SERVICE_TIERS as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
			</select>
		</label>
		<label>
			Placement lane
			<select bind:value={lane}>
				{#each laneOptions as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
			</select>
		</label>
		<label>
			Tenant
			<input type="text" bind:value={tenant} />
		</label>
		<label>
			Environment
			<input type="text" bind:value={environment} />
		</label>
		<label>
			Domain
			<input type="text" bind:value={domain} />
		</label>
		<label>
			Target host
			<input type="text" bind:value={targetHost} />
		</label>
		<label>
			Postgres databases
			<input type="number" min="0" bind:value={postgresDatabases} />
		</label>
		<label>
			Storage (GB)
			<input type="number" min="0" bind:value={storageGb} />
		</label>
		<label>
			Active projects
			<input type="number" min="0" bind:value={activeProjects} />
		</label>
		<label>
			Workspace enabled
			<input type="checkbox" checked={workspaceEnabled} onchange={(event) => (workspaceEnabled = event.currentTarget.checked)} />
		</label>
		<label>
			Generated project name
			<input type="text" value={projectName} disabled />
		</label>
	</div>
	<p class="meta">{selectedTier.description}</p>
	<p class="meta">
		Tier limits: up to {selectedTier.maxPostgresDatabases} Postgres DBs, {selectedTier.maxStorageGb} GB storage, {selectedTier.maxActiveProjects} active projects.
	</p>
	{#if !gate.allowed}
		<p class="warn">
			{gate.requiresPause ? 'Request requires pause for this tier.' : 'Request exceeds tier limits.'}
			{gate.violations.join(' ')}
		</p>
	{/if}
	{#if selectedLane}
		<p class="meta">
			{selectedLane.requiresUniqueHostname ? 'Unique hostname required.' : 'Shared hostnames allowed.'}
			{selectedLane.requiresUniquePortsOnSharedHost ? ' Unique host ports required on shared hosts.' : ' Port reuse allowed in shared cluster mode.'}
		</p>
	{/if}
	<details>
		<summary>Signal webhook sink (optional)</summary>
		<div class="webhook">
			<input type="url" bind:value={webhook} placeholder="https://ops.example.org/shippin/signals" />
			<button type="button" onclick={applyWebhook}>Save webhook</button>
		</div>
		{#if webhookNotice}<p class="meta">{webhookNotice}</p>{/if}
	</details>
	<details>
		<summary>Request payload preview</summary>
		<pre>{JSON.stringify(preview, null, 2)}</pre>
	</details>
	<button type="button" onclick={submit}>Queue deployment request</button>
	{#if notice}<p class="meta">{notice}</p>{/if}
</section>

<style>
	.planner { display: grid; gap: var(--space-2); }
	.grid { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
	label { display: grid; gap: var(--space-1); }
	.webhook { display: flex; gap: var(--space-2); flex-wrap: wrap; }
	button {
		width: fit-content;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-3);
	}
	.meta { color: var(--color-muted); }
	.warn { color: var(--color-danger); margin: 0; }
	pre { margin: 0; overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-2); }
</style>
