import { accountId, jmap, listOf } from './jmap';
import { authorization } from './session';
import {
	DOC_FOLDER,
	DOC_SUFFIX,
	DOC_TYPE,
	bodyOf,
	docFileName,
	wrapDocument
} from './docs-call';
import {
	createFolder,
	downloadPath,
	findByPattern,
	listFolder,
	listSharedDrives,
	sendBlob,
	setErrorMessage,
	toNode,
	type DriveNode
} from './drive';

export * from './docs-call';

const FILES = 'urn:ietf:params:jmap:filenode';
const PROPERTIES = ['id', 'parentId', 'name', 'nodeType', 'size', 'type', 'blobId', 'modified', 'myRights', 'shareWith'];

export type OpenDocument = { node: DriveNode; html: string; account: string };

function newest(nodes: readonly DriveNode[]): DriveNode[] {
	return [...nodes].sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Your documents, and the ones others have shared with you, newest first. */
export async function listDocuments(): Promise<DriveNode[]> {
	const drives = await listSharedDrives();
	const [mine, ...shared] = await Promise.all([
		findByPattern(`*${DOC_SUFFIX}`),
		...drives.map(async (drive) =>
			(await findByPattern(`*${DOC_SUFFIX}`, drive.accountId)).map((node) => ({ ...node, drive: drive.accountId, owner: drive.name }))
		)
	]);
	return newest([...mine, ...shared.flat()]);
}

async function documentsFolder(): Promise<string> {
	const top = await listFolder(null);
	return top.find((node) => node.kind === 'folder' && node.name === DOC_FOLDER)?.id ?? createFolder(null, DOC_FOLDER);
}

/** Makes a new empty document in the Documents folder. A title that is taken becomes "title (2)". */
export async function createDocument(title: string): Promise<string> {
	const account = accountId();
	const [parentId, blobId] = await Promise.all([
		documentsFolder(),
		sendBlob(new Blob([wrapDocument(title, '<p></p>')], { type: DOC_TYPE }), account, title)
	]);
	const responses = await jmap(
		[FILES],
		[['FileNode/set', { accountId: account, onExists: 'rename', create: { doc: { parentId, name: docFileName(title), blobId, type: DOC_TYPE } } }, 's']]
	);
	const payload = responses[0]?.[1] as { created?: Record<string, { id?: string }>; notCreated?: Record<string, { type?: unknown; description?: unknown }> };
	const id = payload?.created?.doc?.id;
	if (!id) throw new Error(setErrorMessage(payload?.notCreated?.doc, 'The document could not be created.'));
	return id;
}

async function readNode(id: string, account: string): Promise<DriveNode | null> {
	const responses = await jmap([FILES], [['FileNode/get', { accountId: account, ids: [id], properties: PROPERTIES }, 'g']]);
	const raw = listOf<Record<string, unknown>>(responses, 'FileNode/get')[0];
	return raw ? toNode(raw) : null;
}

export async function openDocument(id: string, drive?: string): Promise<OpenDocument> {
	const account = drive ?? accountId();
	const node = await readNode(id, account);
	if (!node || !node.blobId) throw new Error('That document is no longer there.');
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch(downloadPath(account, node.blobId, node.name, DOC_TYPE), { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: auth } });
	if (!res.ok) throw new Error('The document could not be opened.');
	return { node, html: bodyOf(await res.text()), account };
}

export type SaveResult = { status: 'saved'; node: DriveNode } | { status: 'conflict' };

/**
 * Saves new content. If the stored file is no longer the one this page opened, nothing
 * is written unless `force` is set, so one person's edits never silently replace another's.
 */
export async function saveDocument(doc: OpenDocument, title: string, body: string, force = false): Promise<SaveResult> {
	const current = await readNode(doc.node.id, doc.account);
	if (!current) throw new Error('That document is no longer there.');
	if (!force && current.blobId !== doc.node.blobId) return { status: 'conflict' };
	const blobId = await sendBlob(new Blob([wrapDocument(title, body)], { type: DOC_TYPE }), accountId(), title);
	const responses = await jmap([FILES], [['FileNode/set', { accountId: doc.account, update: { [doc.node.id]: { blobId, type: DOC_TYPE } } }, 's']]);
	const payload = responses[0]?.[1] as { updated?: Record<string, unknown>; notUpdated?: Record<string, { type?: unknown; description?: unknown }> };
	if (!payload?.updated || !(doc.node.id in payload.updated)) {
		throw new Error(setErrorMessage(payload?.notUpdated?.[doc.node.id], 'The document could not be saved.'));
	}
	const node = await readNode(doc.node.id, doc.account);
	if (!node) throw new Error('That document is no longer there.');
	return { status: 'saved', node };
}

/** Sends a file to this device. */
export function saveToDevice(content: string, type: string, name: string): void {
	const link = document.createElement('a');
	link.href = URL.createObjectURL(new Blob([content], { type }));
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
