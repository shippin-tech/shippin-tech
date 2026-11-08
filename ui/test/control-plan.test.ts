import { describe, expect, it } from 'vitest';
import { controlPlanTemplate, projectNameFor, serviceTier, tierGate } from '../src/lib/platform/control-plan';

describe('control plan template', () => {
	it('loads control lanes and generates stable project names', () => {
		const plan = controlPlanTemplate();
		expect(plan.name).toBe('shippin-enterprise-control-plan');
		expect(plan.lanes.length).toBeGreaterThanOrEqual(3);
		expect(plan.lanes.some((lane) => lane.id === 'hybrid')).toBe(true);
		expect(projectNameFor({ lane: 'hybrid', tenant: 'Acme West', environment: 'Prod' })).toBe('shippin-hybrid-acme-west-prod');
	});

	it('enforces free-tier limits with pause semantics', () => {
		const free = serviceTier('free');
		expect(free.maxPostgresDatabases).toBe(2);
		expect(free.maxStorageGb).toBe(5);
		expect(free.maxActiveProjects).toBe(5);
		const blocked = tierGate({
			tier: 'free',
			workspaceEnabled: true,
			postgresDatabases: 3,
			storageGb: 8,
			activeProjects: 7
		});
		expect(blocked.allowed).toBe(false);
		expect(blocked.requiresPause).toBe(true);
		expect(blocked.violations.length).toBeGreaterThan(0);
		const allowed = tierGate({
			tier: 'small-business',
			workspaceEnabled: true,
			postgresDatabases: 3,
			storageGb: 8,
			activeProjects: 7
		});
		expect(allowed.allowed).toBe(true);
	});
});
