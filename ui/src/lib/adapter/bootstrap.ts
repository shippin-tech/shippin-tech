import { accountId, jmap, listOf } from './jmap';
import { registryGet } from './portal-call';

export async function loadBootstrap(): Promise<Record<string, unknown>[]> {
	const responses = await jmap([], [registryGet('x:Bootstrap', accountId())]);
	return listOf(responses, 'x:Bootstrap/get');
}
