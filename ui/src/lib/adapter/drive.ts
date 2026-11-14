import { accountId, idsOf, jmap, listOf, type MethodResponse } from './jmap';
import { authorization } from './session';
import {
	downloadPath,
	searchPattern,
	roleOf,
	setErrorMessage,
	shareMap,
	sortNodes,
	toNode,
	topShared,
	uploadProblem,
	type DriveNode,
	type DriveShare,
	type DriveUsage,
	type ShareRole,
	type SharedDrive
} from './drive-call';

export * from './drive-call';

const FILES = 'urn:ietf:params:jmap:filenode';
const QUOTA = 'urn:ietf:params:jmap:quota';
const PRINCIPALS = 'urn:ietf:params:jmap:principals';
const PROPERTIES = ['id', 'parentId', 'name', 'nodeType', 'size', 'type', 'blobId', 'modified', 'myRights', 'shareWith'];

type SetPayload = {
	created?: Record<string, { id?: string }>;
	notCreated?: Record<string, { type?: unknown; description?: unknown }>;
	updated?: Record<string, unknown>;
	notUpdated?: Record<string, { type?: unknown; description?: unknown }>;
	destroyed?: string[];
	notDestroyed?: Record<string, { type?: unknown; description?: unknown }>;
};

function setPayload(responses: MethodResponse[]): SetPayload {
	return (responses.find((response) => response[0] === 'FileNode/set')?.[1] ?? {}) as SetPayload;
}

async function queryNodes(account: string, filter: Record<string, unknown> | undefined, limit?: number): Promise<DriveNode[]> {
	const responses = await jmap(
		[FILES],
		[
			['FileNode/query', { accountId: account, ...(filter ? { filter } : {}), ...(limit ? { limit } : {}) }, 'q'],
			[
				'FileNode/get',
				{ accountId: account, '#ids': { resultOf: 'q', name: 'FileNode/query', path: '/ids' }, properties: PROPERTIES },
				'g'
			]
		]
	);
	const nodes = listOf<Record<string, unknown>>(responses, 'FileNode/get').flatMap((raw) => toNode(raw) ?? []);
	return idsOf(responses, 'FileNode/query').length ? sortNodes(nodes) : [];
}

/** What is inside a folder; `null` is the top of Drive. */
export function listFolder(parentId: string | null, account = accountId()): Promise<DriveNode[]> {
	return queryNodes(account, parentId ? { parentId } : { isTopLevel: true });
}

/** Every folder, for the path at the top of the page and for choosing where to move things. */
export function listFolders(account = accountId()): Promise<DriveNode[]> {
	return queryNodes(account, { nodeType: 'directory' });
}

export function searchDrive(text: string, account = accountId()): Promise<DriveNode[]> {
	return queryNodes(account, { nameMatch: searchPattern(text) }, 200);
}

export function findByPattern(pattern: string, account = accountId()): Promise<DriveNode[]> {
	return queryNodes(account, { nameMatch: pattern }, 500);
}

/** Other people's Drives this person has been given something in. */
export async function listSharedDrives(): Promise<SharedDrive[]> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch('/jmap/session', { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: auth } });
	if (!res.ok) throw new Error('Shared files could not be loaded.');
	const session = (await res.json()) as { accounts?: Record<string, { name?: unknown; isPersonal?: unknown; accountCapabilities?: Record<string, unknown> }> };
	return Object.entries(session.accounts ?? {})
		.filter(([, info]) => info.isPersonal !== true && info.accountCapabilities?.[FILES])
		.map(([id, info]) => ({ accountId: id, name: typeof info.name === 'string' ? info.name : id }));
}

/** What one person has shared with you: the highest things you can see in their Drive. */
export async function listSharedWithMe(drive: SharedDrive): Promise<DriveNode[]> {
	return topShared(await queryNodes(drive.accountId, undefined)).map((node) => ({ ...node, drive: drive.accountId, owner: drive.name }));
}

async function findPrincipals(ids: string[]): Promise<Map<string, string>> {
	if (!ids.length) return new Map();
	const responses = await jmap([PRINCIPALS], [['Principal/get', { accountId: accountId(), ids, properties: ['id', 'name', 'email'] }, 'g']]);
	return new Map(
		listOf<{ id?: unknown; name?: unknown; email?: unknown }>(responses, 'Principal/get').map((row) => [
			String(row.id),
			typeof row.email === 'string' && row.email ? row.email : String(row.name ?? row.id)
		])
	);
}

/** Finds someone on your domain by address, or null. */
export async function findPerson(email: string): Promise<{ id: string; name: string } | null> {
	const responses = await jmap([PRINCIPALS], [['Principal/query', { accountId: accountId(), filter: { email: email.trim().toLowerCase() } }, 'q']]);
	const id = idsOf(responses, 'Principal/query')[0];
	if (!id) return null;
	const names = await findPrincipals([id]);
	return names.has(id) ? { id, name: names.get(id)! } : null;
}

export async function loadShares(nodeId: string, account = accountId()): Promise<DriveShare[]> {
	const responses = await jmap([FILES], [['FileNode/get', { accountId: account, ids: [nodeId], properties: ['id', 'shareWith'] }, 'g']]);
	const shareWith = (listOf<{ shareWith?: Record<string, Record<string, unknown>> | null }>(responses, 'FileNode/get')[0]?.shareWith ?? {}) as Record<string, Record<string, unknown>>;
	const names = await findPrincipals(Object.keys(shareWith));
	return Object.entries(shareWith)
		.map(([principalId, rights]) => ({ principalId, name: names.get(principalId) ?? principalId, role: roleOf(rights) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Replaces who a file or folder is shared with. */
export function saveShares(nodeId: string, shares: readonly Pick<DriveShare, 'principalId' | 'role'>[], account = accountId()): Promise<void> {
	return updateNode(nodeId, { shareWith: shareMap(shares) }, 'Sharing could not be changed.', account);
}

export type { ShareRole };

/** How much storage is used, when the account has a limit. */
export async function loadUsage(): Promise<DriveUsage | null> {
	const responses = await jmap([QUOTA], [['Quota/get', { accountId: accountId(), ids: null }, 'q']]);
	const quota = listOf<{ resourceType?: unknown; used?: unknown; hardLimit?: unknown }>(responses, 'Quota/get').find(
		(item) => item.resourceType === 'octets'
	);
	if (!quota || typeof quota.used !== 'number') return null;
	return { used: quota.used, limit: typeof quota.hardLimit === 'number' && quota.hardLimit > 0 ? quota.hardLimit : null };
}

export async function createFolder(parentId: string | null, name: string, account = accountId()): Promise<string> {
	const payload = setPayload(
		await jmap([FILES], [['FileNode/set', { accountId: account, create: { folder: { parentId, name: name.trim() } } }, 's']])
	);
	const id = payload.created?.folder?.id;
	if (!id) throw new Error(setErrorMessage(payload.notCreated?.folder, 'The folder could not be created.'));
	return id;
}

/** Sends the bytes; XHR rather than fetch because fetch cannot report upload progress. */
function sendBytes(file: Blob, name: string, account: string, onProgress: (sent: number) => void): Promise<string> {
	const auth = authorization();
	if (!auth) return Promise.reject(new Error('sign-in required'));
	const url = `/jmap/upload/${encodeURIComponent(account)}/`;
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.setRequestHeader('Authorization', auth);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.upload.onprogress = (event) => onProgress(event.loaded);
		xhr.onerror = () => reject(new Error(`${name} could not be uploaded.`));
		xhr.onload = () => {
			let blobId: unknown;
			try {
				blobId = (JSON.parse(xhr.responseText) as { blobId?: unknown }).blobId;
			} catch {
				blobId = undefined;
			}
			if (xhr.status >= 200 && xhr.status < 300 && typeof blobId === 'string') resolve(blobId);
			else reject(new Error(uploadProblem(xhr.status, name)));
		};
		xhr.send(file);
	});
}

/** Uploads bytes and returns their blob id. */
export function sendBlob(content: Blob, account: string, name: string): Promise<string> {
	return sendBytes(content, name, account, () => undefined);
}

/** Uploads a file into a folder. A name that is taken becomes "name (2)"; nothing is overwritten. */
export async function uploadFile(file: File, parentId: string | null, onProgress: (sent: number) => void, account = accountId()): Promise<void> {
	// Bytes always go to your own account; the file then links them into whichever Drive it lives in.
	const blobId = await sendBytes(file, file.name, accountId(), onProgress);
	const payload = setPayload(
		await jmap(
			[FILES],
			[
				[
					'FileNode/set',
					{
						accountId: account,
						onExists: 'rename',
						create: { file: { parentId, name: file.name, blobId, type: file.type || 'application/octet-stream' } }
					},
					's'
				]
			]
		)
	);
	if (!payload.created?.file?.id) throw new Error(setErrorMessage(payload.notCreated?.file, `${file.name} could not be saved.`));
}

async function updateNode(id: string, patch: Record<string, unknown>, fallback: string, account = accountId()): Promise<void> {
	const payload = setPayload(await jmap([FILES], [['FileNode/set', { accountId: account, update: { [id]: patch } }, 's']]));
	if (payload.notUpdated?.[id] || !payload.updated || !(id in payload.updated)) {
		throw new Error(setErrorMessage(payload.notUpdated?.[id], fallback));
	}
}

export function renameNode(id: string, name: string, account = accountId()): Promise<void> {
	return updateNode(id, { name: name.trim() }, 'It could not be renamed.', account);
}

export function moveNode(id: string, parentId: string | null, account = accountId()): Promise<void> {
	return updateNode(id, { parentId }, 'It could not be moved.', account);
}

/** Deletes a file, or a folder with everything in it. */
export async function removeNode(id: string, account = accountId()): Promise<void> {
	const payload = setPayload(
		await jmap([FILES], [['FileNode/set', { accountId: account, destroy: [id], onDestroyRemoveChildren: true }, 's']])
	);
	if (!payload.destroyed?.includes(id)) throw new Error(setErrorMessage(payload.notDestroyed?.[id], 'It could not be deleted.'));
}

/** Downloads with the session's credentials, which a plain link cannot carry. */
export async function downloadNode(node: DriveNode, account = accountId()): Promise<void> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	if (!node.blobId) throw new Error(`${node.name} has no content to download.`);
	const res = await fetch(downloadPath(account, node.blobId, node.name, node.type), {
		credentials: 'same-origin',
		headers: { Authorization: auth }
	});
	if (!res.ok) throw new Error(`${node.name} could not be downloaded.`);
	const link = document.createElement('a');
	link.href = URL.createObjectURL(await res.blob());
	link.download = node.name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
