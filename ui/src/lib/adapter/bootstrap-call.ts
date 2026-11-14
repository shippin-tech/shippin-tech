import type { MethodCall } from './jmap';

export function bootstrapSet(accountId: string, patch: Record<string, unknown>): MethodCall {
	return ['x:Bootstrap/set', { accountId, update: { singleton: patch } }, 's0'];
}

export function bootstrapResult(payload: Record<string, unknown>): 'saved' | 'rejected' | 'missing' {
	const updated = payload.updated;
	if (isRecord(updated) && 'singleton' in updated) return 'saved';
	const notUpdated = payload.notUpdated;
	if (isRecord(notUpdated) && 'singleton' in notUpdated) return 'rejected';
	return 'missing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object';
}
