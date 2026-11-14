/**
 * Pure helpers for Drive. The server side is JMAP FileNode (crates/jmap/src/file);
 * the calls live in adapter/drive.ts.
 */

export type DriveRights = { add: boolean; rename: boolean; remove: boolean; modify: boolean; share: boolean };

export type DriveNode = {
	id: string;
	parentId: string | null;
	name: string;
	kind: 'file' | 'folder';
	size: number;
	type: string;
	blobId: string | null;
	modified: string;
	rights: DriveRights;
	shared: boolean;
	/** Set on things in someone else's Drive: whose it is. */
	drive?: string;
	owner?: string;
};

export type ShareRole = 'viewer' | 'editor';

export type DriveShare = { principalId: string; name: string; role: ShareRole };

export type SharedDrive = { accountId: string; name: string };

export const FULL_RIGHTS: DriveRights = { add: true, rename: true, remove: true, modify: true, share: true };
export const NO_RIGHTS: DriveRights = { add: false, rename: false, remove: false, modify: false, share: false };

export const ROLE_LABELS: Record<ShareRole, string> = { viewer: 'Can view', editor: 'Can edit' };

/** The server rights each role grants. */
export function roleRights(role: ShareRole): Record<string, boolean> {
	const edit = role === 'editor';
	return {
		mayRead: true,
		mayAddChildren: edit,
		mayRename: edit,
		mayDelete: edit,
		mayModifyContent: edit,
		mayShare: false
	};
}

export function roleOf(rights: Record<string, unknown>): ShareRole {
	return rights.mayModifyContent === true || rights.mayAddChildren === true ? 'editor' : 'viewer';
}

function toRights(raw: unknown): DriveRights {
	if (!raw || typeof raw !== 'object') return FULL_RIGHTS;
	const rights = raw as Record<string, unknown>;
	return {
		add: rights.mayAddChildren === true,
		rename: rights.mayRename === true,
		remove: rights.mayDelete === true,
		modify: rights.mayModifyContent === true,
		share: rights.mayShare === true
	};
}

/** Nodes with nothing visible above them: what someone else has shared with you. */
export function topShared(nodes: readonly DriveNode[]): DriveNode[] {
	const visible = new Set(nodes.map((node) => node.id));
	return sortNodes(nodes.filter((node) => !node.parentId || !visible.has(node.parentId)));
}

/** The shareWith map for a set of people and roles. */
export function shareMap(shares: readonly Pick<DriveShare, 'principalId' | 'role'>[]): Record<string, Record<string, boolean>> {
	return Object.fromEntries(shares.map((share) => [share.principalId, roleRights(share.role)]));
}

export type DriveCrumb = { id: string | null; name: string };

export type DriveUsage = { used: number; limit: number | null };

export type UploadState = {
	id: string;
	name: string;
	size: number;
	sent: number;
	status: 'uploading' | 'done' | 'failed';
	error: string;
};

export const ROOT_NAME = 'My Drive';

type RawNode = {
	id?: unknown;
	parentId?: unknown;
	name?: unknown;
	nodeType?: unknown;
	size?: unknown;
	type?: unknown;
	blobId?: unknown;
	modified?: unknown;
	myRights?: unknown;
	shareWith?: unknown;
};

export function toNode(raw: RawNode): DriveNode | null {
	if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
	if (raw.nodeType === 'symlink') return null;
	return {
		id: raw.id,
		parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
		name: raw.name,
		kind: raw.nodeType === 'directory' ? 'folder' : 'file',
		size: typeof raw.size === 'number' ? raw.size : 0,
		type: typeof raw.type === 'string' ? raw.type : '',
		blobId: typeof raw.blobId === 'string' ? raw.blobId : null,
		modified: typeof raw.modified === 'string' ? raw.modified : '',
		rights: toRights(raw.myRights),
		shared: !!raw.shareWith && typeof raw.shareWith === 'object' && Object.keys(raw.shareWith).length > 0
	};
}

/** Folders first, then by name, the way people expect a file list to read. */
export function sortNodes(nodes: readonly DriveNode[]): DriveNode[] {
	return [...nodes].sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
	});
}

/** The path from the top of Drive to a folder, given every folder walked so far. */
export function breadcrumbs(
	folderId: string | null,
	known: ReadonlyMap<string, DriveNode>,
	root: DriveCrumb = { id: null, name: ROOT_NAME }
): DriveCrumb[] {
	const trail: DriveCrumb[] = [];
	const seen = new Set<string>();
	let current = folderId;
	while (current && !seen.has(current)) {
		seen.add(current);
		const node = known.get(current);
		if (!node) break;
		trail.unshift({ id: node.id, name: node.name });
		current = node.parentId;
	}
	return [root, ...trail];
}

const FORBIDDEN = /[/<>:"\\|?*]/;
const RESERVED = new Set([
	'.', '..', 'CON', 'PRN', 'AUX', 'NUL',
	'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
	'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

/** Why a name cannot be used, or an empty string when it can. Mirrors the server's rules. */
export function nameProblem(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return 'Enter a name.';
	if (new TextEncoder().encode(trimmed).length > 255) return 'That name is too long.';
	if (FORBIDDEN.test(trimmed)) return 'A name cannot contain / < > : " \\ | ? or *.';
	if (RESERVED.has(trimmed.toUpperCase())) return 'That name is reserved. Choose another.';
	return '';
}

/** A folder cannot move into itself or anything inside it. */
export function canMoveInto(moving: DriveNode, target: string | null, known: ReadonlyMap<string, DriveNode>): boolean {
	if (target === moving.parentId) return false;
	const seen = new Set<string>();
	let current = target;
	while (current && !seen.has(current)) {
		if (current === moving.id) return false;
		seen.add(current);
		current = known.get(current)?.parentId ?? null;
	}
	return true;
}

/** The server's refusal, in words a person can act on. */
export function setErrorMessage(error: { type?: unknown; description?: unknown } | undefined, fallback: string): string {
	switch (error?.type) {
		case 'overQuota':
			return 'You are out of storage. Delete something or ask for more space.';
		case 'alreadyExists':
			return 'Something with that name is already here.';
		case 'forbidden':
			return 'You do not have permission to do that.';
		case 'notFound':
			return 'It is no longer there. Refresh and try again.';
		default:
			return typeof error?.description === 'string' && error.description ? error.description : fallback;
	}
}

export function uploadProblem(status: number, name: string): string {
	if (status === 413) return `${name} is too large to upload.`;
	if (status === 401) return 'Sign in again to upload.';
	return `${name} could not be uploaded.`;
}

/** A search box entry as a server name pattern: anything containing the words, ignoring glob characters. */
export function searchPattern(text: string): string {
	return `*${text.trim().replace(/[*?[\]\\]/g, '')}*`;
}

export function downloadPath(accountId: string, blobId: string, name: string, type: string): string {
	const path = [accountId, blobId, name].map(encodeURIComponent).join('/');
	return `/jmap/download/${path}?accept=${encodeURIComponent(type || 'application/octet-stream')}`;
}

export function usagePercent(usage: DriveUsage | null): number | null {
	if (!usage || !usage.limit) return null;
	return Math.min(100, Math.round((usage.used / usage.limit) * 100));
}

export function kindLabel(node: DriveNode): string {
	if (node.kind === 'folder') return 'Folder';
	if (node.name.toLowerCase().endsWith('.shdoc.html')) return 'Document';
	const dot = node.name.lastIndexOf('.');
	const extension = dot > 0 ? node.name.slice(dot + 1).toUpperCase() : '';
	return extension && extension.length <= 5 ? `${extension} file` : 'File';
}
