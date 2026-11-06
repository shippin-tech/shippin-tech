import { accountId, jmap, listOf } from './jmap';
import { registryGet, usingFor } from './portal-call';

export { cell, registryGet, rowCells, usingFor } from './portal-call';

export async function loadRegistry(objectName: string): Promise<Record<string, unknown>[]> {
	const responses = await jmap(usingFor(objectName), [registryGet(objectName, accountId())]);
	return listOf<Record<string, unknown>>(responses, `${objectName}/get`);
}
