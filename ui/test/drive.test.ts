import { describe, expect, it } from 'vitest';
import {
	FULL_RIGHTS,
	breadcrumbs,
	canMoveInto,
	downloadPath,
	kindLabel,
	nameProblem,
	roleOf,
	roleRights,
	searchPattern,
	setErrorMessage,
	shareMap,
	sortNodes,
	toNode,
	topShared,
	uploadProblem,
	usagePercent,
	type DriveNode
} from '../src/lib/adapter/drive-call';

function node(id: string, name: string, parentId: string | null, kind: 'file' | 'folder' = 'folder'): DriveNode {
	return { id, name, parentId, kind, size: 0, type: '', blobId: kind === 'file' ? 'b' : null, modified: '', rights: FULL_RIGHTS, shared: false };
}

const a = node('a', 'A', null);
const b = node('b', 'B', 'a');
const c = node('c', 'C', 'b');
const known = new Map([a, b, c].map((item) => [item.id, item]));

describe('Drive helpers', () => {
	it('reads server nodes and skips what it cannot show', () => {
		expect(toNode({ id: 'x', name: 'n.txt', nodeType: 'file', size: 3, parentId: 'p', blobId: 'b', type: 'text/plain', modified: 'm' })).toEqual({
			id: 'x', name: 'n.txt', kind: 'file', size: 3, parentId: 'p', blobId: 'b', type: 'text/plain', modified: 'm', rights: FULL_RIGHTS, shared: false
		});
		const shared = toNode({ id: 'x', name: 'n', nodeType: 'file', shareWith: { y: {} }, myRights: { mayRead: true, mayRename: true } });
		expect(shared?.shared).toBe(true);
		expect(shared?.rights).toEqual({ add: false, rename: true, remove: false, modify: false, share: false });
		expect(toNode({ id: 'x', name: 'dir', nodeType: 'directory', parentId: null })?.kind).toBe('folder');
		expect(toNode({ id: 'x', name: 'link', nodeType: 'symlink' })).toBeNull();
		expect(toNode({ name: 'no id' })).toBeNull();
	});

	it('lists folders first, then names in natural order', () => {
		const sorted = sortNodes([node('1', 'file10', null, 'file'), node('2', 'file2', null, 'file'), node('3', 'zed', null)]);
		expect(sorted.map((item) => item.name)).toEqual(['zed', 'file2', 'file10']);
	});

	it('builds the folder path and survives loops and gaps', () => {
		expect(breadcrumbs(null, known)).toEqual([{ id: null, name: 'My Drive' }]);
		expect(breadcrumbs('c', known).map((crumb) => crumb.name)).toEqual(['My Drive', 'A', 'B', 'C']);
		expect(breadcrumbs('missing', known)).toEqual([{ id: null, name: 'My Drive' }]);
		const loop = new Map([['x', node('x', 'X', 'y')], ['y', node('y', 'Y', 'x')]]);
		expect(breadcrumbs('x', loop).length).toBe(3);
	});

	it('applies the server naming rules', () => {
		expect(nameProblem('Taxes 2026.pdf')).toBe('');
		expect(nameProblem('   ')).toBe('Enter a name.');
		expect(nameProblem('a/b')).toContain('cannot contain');
		expect(nameProblem('con')).toContain('reserved');
		expect(nameProblem('..')).toContain('reserved');
		expect(nameProblem('x'.repeat(256))).toContain('too long');
	});

	it('maps sharing roles to server rights and back', () => {
		expect(roleRights('viewer')).toEqual({ mayRead: true, mayAddChildren: false, mayRename: false, mayDelete: false, mayModifyContent: false, mayShare: false });
		expect(roleRights('editor')).toMatchObject({ mayAddChildren: true, mayRename: true, mayDelete: true, mayModifyContent: true, mayShare: false });
		expect(roleOf(roleRights('viewer'))).toBe('viewer');
		expect(roleOf(roleRights('editor'))).toBe('editor');
		expect(shareMap([{ principalId: 'p', role: 'viewer' }])).toEqual({ p: roleRights('viewer') });
		expect(shareMap([])).toEqual({});
	});

	it('shows only the highest shared items', () => {
		const inner = node('i', 'inner', 'hidden-parent', 'file');
		const child = node('c2', 'child', 'a', 'file');
		expect(topShared([a, child, inner]).map((item) => item.id)).toEqual(['a', 'i']);
	});

	it('uses the shared root in the folder path', () => {
		expect(breadcrumbs('b', known, { id: null, name: 'Shared with me' }).map((crumb) => crumb.name)).toEqual(['Shared with me', 'A', 'B']);
	});

	it('never moves a folder into itself or where it already is', () => {
		expect(canMoveInto(a, 'c', known)).toBe(false);
		expect(canMoveInto(a, 'a', known)).toBe(false);
		expect(canMoveInto(b, 'a', known)).toBe(false);
		expect(canMoveInto(c, 'a', known)).toBe(true);
		expect(canMoveInto(b, null, known)).toBe(true);
		expect(canMoveInto(a, null, known)).toBe(false);
	});

	it('explains refusals in plain words', () => {
		expect(setErrorMessage({ type: 'overQuota' }, 'x')).toContain('out of storage');
		expect(setErrorMessage({ type: 'alreadyExists' }, 'x')).toContain('already here');
		expect(setErrorMessage({ type: 'other', description: 'Because.' }, 'x')).toBe('Because.');
		expect(setErrorMessage(undefined, 'fallback')).toBe('fallback');
		expect(uploadProblem(413, 'big.zip')).toBe('big.zip is too large to upload.');
	});

	it('builds search patterns, download links, usage and labels', () => {
		expect(searchPattern(' re*port? ')).toBe('*report*');
		expect(downloadPath('b', 'blob', 'a b.txt', 'text/plain')).toBe('/jmap/download/b/blob/a%20b.txt?accept=text%2Fplain');
		expect(downloadPath('b', 'blob', 'x', '')).toContain('application%2Foctet-stream');
		expect(usagePercent({ used: 50, limit: 200 })).toBe(25);
		expect(usagePercent({ used: 500, limit: 200 })).toBe(100);
		expect(usagePercent({ used: 5, limit: null })).toBeNull();
		expect(usagePercent(null)).toBeNull();
		expect(kindLabel(node('1', 'report.pdf', null, 'file'))).toBe('PDF file');
		expect(kindLabel(node('1', 'README', null, 'file'))).toBe('File');
		expect(kindLabel(a)).toBe('Folder');
	});
});
