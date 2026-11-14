import type { MethodCall } from './jmap';

export function actionCreate(name: string, parameters: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...parameters, '@type': name };
}

export function actionSet(accountId: string, name: string, parameters: Record<string, unknown> = {}): MethodCall {
	return ['x:Action/set', { accountId, create: { a0: actionCreate(name, parameters) } }, 's0'];
}

export function actionResult(payload: Record<string, unknown>, id: string): 'saved' | 'rejected' | 'missing' {
	const created = payload.created;
	if (created && typeof created === 'object' && id in created) return 'saved';
	const rejected = payload.notCreated;
	if (rejected && typeof rejected === 'object' && id in rejected) return 'rejected';
	return 'missing';
}
