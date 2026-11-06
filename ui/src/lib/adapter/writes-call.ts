import type { MethodCall } from './jmap';

export type RegistryChange =
	| { create: Record<string, Record<string, unknown>> }
	| { update: Record<string, Record<string, unknown>> }
	| { destroy: string[] };

export function registrySet(objectName: string, accountId: string, change: RegistryChange): MethodCall {
	return [`${objectName}/set`, { accountId, ...change }, 's0'];
}

export function setResult(payload: Record<string, unknown>, id: string): 'saved' | 'rejected' | 'missing' {
	if (listed(payload.destroyed, id) || mapped(payload.updated, id) || mapped(payload.created, id)) return 'saved';
	if (mapped(payload.notDestroyed, id) || mapped(payload.notUpdated, id) || mapped(payload.notCreated, id)) {
		return 'rejected';
	}
	return 'missing';
}

function listed(value: unknown, id: string): boolean {
	return Array.isArray(value) && value.map(String).includes(id);
}

function mapped(value: unknown, id: string): boolean {
	return !!value && typeof value === 'object' && id in value;
}
