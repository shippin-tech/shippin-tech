import { accountId, jmap } from './jmap';
import { actionSet } from './action-call';

export async function executeAction(name: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
	const responses = await jmap([], [actionSet(accountId(), name, parameters)]);
	const payload = responses.find(([method]) => method === 'x:Action/set')?.[1];
	const failure = (payload?.notCreated as Record<string, { type?: string; description?: string; properties?: string[] }> | undefined)?.a0;
	if (failure) throw new Error((failure.description || failure.type || 'Action rejected.') + (failure.properties?.length ? ` (${failure.properties.join(', ')})` : ''));
	const created = (payload?.created as Record<string, Record<string, unknown>> | undefined)?.a0;
	if (!created) throw new Error('The server did not confirm the action.');
	return Object.fromEntries(Object.entries(created).filter(([key]) => key !== 'id' && key !== 'blobId'));
}
