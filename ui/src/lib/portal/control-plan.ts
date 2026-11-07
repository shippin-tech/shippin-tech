export type DeploymentLane = {
	id: 'dedicated_stack_per_client' | 'shared_cluster_multi_tenant' | 'hybrid';
	label: string;
	whenToUse: string;
	isolation: string;
	operations: readonly string[];
};

export type ScriptedEvent = {
	id: string;
	label: string;
	purpose: string;
	actionName: string;
};

export const deploymentLanes: readonly DeploymentLane[] = [
	{
		id: 'dedicated_stack_per_client',
		label: 'Dedicated stack per client',
		whenToUse: 'Regulated, enterprise, or contract-isolated tenants.',
		isolation: 'Strong: separate project, volume, credentials, and routing per client.',
		operations: [
			'Set a unique COMPOSE_PROJECT_NAME and MAIL_HOSTNAME for every client instance.',
			'Pin one image digest per rollout wave and promote only after canary validation.',
			'Track rollback digest per client in deployments.log and server.env.previous.'
		]
	},
	{
		id: 'shared_cluster_multi_tenant',
		label: 'Shared cluster multi-tenant',
		whenToUse: 'Cost-optimized default for low/medium compliance tenants.',
		isolation: 'Policy isolation in one cluster; requires strict tenant boundaries.',
		operations: [
			'Use tenant-scoped roles, domains, and policy defaults.',
			'Roll out image digests by ring: internal, pilot, broad.',
			'Monitor tenant-level health, auth failures, and delivery errors per release.'
		]
	},
	{
		id: 'hybrid',
		label: 'Hybrid',
		whenToUse: 'Default shared lane with optional dedicated upgrade path.',
		isolation: 'Shared by default; dedicated isolation for premium/regulatory clients.',
		operations: [
			'Keep one control workflow and choose lane per client policy.',
			'Promote validated shared changes to dedicated lanes after compatibility checks.',
			'Use the same scripted events for every lane to keep operations predictable.'
		]
	}
];

export const scriptedEvents: readonly ScriptedEvent[] = [
	{
		id: 'bootstrap.instance',
		label: 'Bootstrap Instance',
		purpose: 'Validate config, register storage/coordinator singletons, and start healthy.',
		actionName: 'ReloadSettings'
	},
	{
		id: 'promote.canary',
		label: 'Promote Canary',
		purpose: 'Deploy digest to one instance, verify login/send/receive/shared access, then continue.',
		actionName: 'UpdateApps'
	},
	{
		id: 'promote.wave',
		label: 'Promote Wave',
		purpose: 'Roll out digest across remaining instances in a controlled sequence.',
		actionName: 'UpdateApps'
	},
	{
		id: 'rollback.digest',
		label: 'Rollback Digest',
		purpose: 'Redeploy a known-good pinned digest when a wave fails validation.',
		actionName: 'ReloadSettings'
	},
	{
		id: 'drill.recovery',
		label: 'Recovery Drill',
		purpose: 'Rehearse backup/restore and redeploy flow for operational readiness.',
		actionName: 'InvalidateCaches'
	}
];
