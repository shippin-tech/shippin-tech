import { accountId, jmap, listOf } from './jmap';
import { bootstrapResult, bootstrapSet } from './bootstrap-call';
import { registryGet } from './portal-call';
import { bootstrapPatch, credentialLines, type FinishResult } from '$lib/portal/bootstrap';

export async function loadBootstrap(): Promise<Record<string, unknown>[]> {
	const responses = await jmap([], [registryGet('x:Bootstrap', accountId())]);
	return listOf(responses, 'x:Bootstrap/get');
}

type BootstrapStep = { fields: readonly { name: string; kind: string }[] };

export async function completeBootstrap(
	steps: readonly BootstrapStep[],
	values: Record<string, string | boolean>
): Promise<FinishResult> {
	const id = accountId();
	const patch = bootstrapPatch(steps, values);
	const responses = await jmap([], [bootstrapSet(id, patch)]);
	const payload = responses.find(([method]) => method === 'x:Bootstrap/set')?.[1] ?? {};
	const status = bootstrapResult(payload);
	if (status !== 'saved') return { status };
	const records = await loadBootstrap();
	return { status: 'saved', credentials: credentialLines(records[0] ?? {}) };
}
