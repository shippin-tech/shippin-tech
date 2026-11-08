import planSource from '../../../../deploy/control-plan.template.json?raw';

export type ControlLane = {
	id: string;
	label: string;
	projectNamePattern: string;
	requiresUniquePortsOnSharedHost: boolean;
	requiresUniqueHostname: boolean;
};

export type ControlPlanTemplate = {
	version: number;
	status: string;
	description: string;
	name: string;
	lanes: ControlLane[];
};

export type DeploymentRequest = {
	blueprint: string;
	mode: 'managed' | 'self-host';
	tier: ServiceTierId;
	lane: string;
	projectName: string;
	tenant: string;
	environment: string;
	domain: string;
	targetHost: string;
	workspaceEnabled: boolean;
	postgresDatabases: number;
	storageGb: number;
	activeProjects: number;
};

export type ServiceTierId = 'free' | 'small-business' | 'enterprise';

export type ServiceTier = {
	id: ServiceTierId;
	label: string;
	description: string;
	maxPostgresDatabases: number;
	maxStorageGb: number;
	maxActiveProjects: number;
	workspaceEnabled: boolean;
	pauseRequiredWhenExceeded: boolean;
};

export type TierGateResult = {
	allowed: boolean;
	requiresPause: boolean;
	violations: string[];
};

let cachedTemplate: ControlPlanTemplate | null = null;

export const SERVICE_TIERS: readonly ServiceTier[] = [
	{
		id: 'free',
		label: 'Free / Starter',
		description: 'Layman-friendly starter tier for early usage and onboarding.',
		maxPostgresDatabases: 2,
		maxStorageGb: 5,
		maxActiveProjects: 5,
		workspaceEnabled: true,
		pauseRequiredWhenExceeded: true
	},
	{
		id: 'small-business',
		label: 'Small Business',
		description: 'Higher limits and continuity for small teams running production workloads.',
		maxPostgresDatabases: 8,
		maxStorageGb: 100,
		maxActiveProjects: 30,
		workspaceEnabled: true,
		pauseRequiredWhenExceeded: false
	},
	{
		id: 'enterprise',
		label: 'Enterprise Control Plane',
		description: 'Dedicated enterprise controls with negotiated capacity and custom policy.',
		maxPostgresDatabases: 100,
		maxStorageGb: 2048,
		maxActiveProjects: 500,
		workspaceEnabled: true,
		pauseRequiredWhenExceeded: false
	}
];

export function controlPlanTemplate(): ControlPlanTemplate {
	if (cachedTemplate) return cachedTemplate;
	const parsed = JSON.parse(planSource) as Partial<ControlPlanTemplate>;
	cachedTemplate = {
		version: parsed.version ?? 1,
		status: parsed.status ?? 'design-only',
		description: parsed.description ?? '',
		name: parsed.name ?? 'shippin-enterprise-control-plan',
		lanes: Array.isArray(parsed.lanes) ? parsed.lanes.map((lane) => ({
			id: String((lane as ControlLane).id ?? ''),
			label: String((lane as ControlLane).label ?? ''),
			projectNamePattern: String((lane as ControlLane).projectNamePattern ?? ''),
			requiresUniquePortsOnSharedHost: Boolean((lane as ControlLane).requiresUniquePortsOnSharedHost),
			requiresUniqueHostname: Boolean((lane as ControlLane).requiresUniqueHostname)
		})) : []
	};
	return cachedTemplate;
}

export function projectNameFor(request: Pick<DeploymentRequest, 'lane' | 'tenant' | 'environment'>): string {
	const lane = request.lane.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
	const tenant = request.tenant.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
	const env = request.environment.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
	return `shippin-${lane}-${tenant}-${env}`.replace(/-+/g, '-');
}

export function serviceTier(id: ServiceTierId): ServiceTier {
	return SERVICE_TIERS.find((tier) => tier.id === id) ?? SERVICE_TIERS[0];
}

export function tierGate(request: Pick<DeploymentRequest, 'tier' | 'workspaceEnabled' | 'postgresDatabases' | 'storageGb' | 'activeProjects'>): TierGateResult {
	const tier = serviceTier(request.tier);
	const violations: string[] = [];
	if (request.workspaceEnabled && !tier.workspaceEnabled) violations.push('Workspace is not available for this tier.');
	if (request.postgresDatabases > tier.maxPostgresDatabases) violations.push(`Postgres databases exceed ${tier.maxPostgresDatabases}.`);
	if (request.storageGb > tier.maxStorageGb) violations.push(`Storage exceeds ${tier.maxStorageGb} GB.`);
	if (request.activeProjects > tier.maxActiveProjects) violations.push(`Active projects exceed ${tier.maxActiveProjects}.`);
	const requiresPause = violations.length > 0 && tier.pauseRequiredWhenExceeded;
	return {
		allowed: violations.length === 0,
		requiresPause,
		violations
	};
}
