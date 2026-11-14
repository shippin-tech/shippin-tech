import { describe, expect, it } from 'vitest';
import { FOLDER_TYPE, copyName, googleKind, isFolder, isGoogleDocument, parseStatus, toGoogleFile, type GoogleFile } from '../src/lib/adapter/google-call';

function file(overrides: Partial<GoogleFile> = {}): GoogleFile {
	return { id: '1', name: 'report.pdf', type: 'application/pdf', size: 3, modified: '', webLink: '', exports: [], ...overrides };
}

describe('Google link helpers', () => {
	it('reads the status', () => {
		expect(parseStatus({ available: true, connected: true, email: 'a@b.test' })).toEqual({ available: true, connected: true, email: 'a@b.test' });
		expect(parseStatus(null)).toEqual({ available: false, connected: false, email: null });
	});

	it('reads files and skips what it cannot show', () => {
		expect(toGoogleFile({ id: 'x', name: 'n', type: 't', size: 5, exports: ['pdf', 7] })).toMatchObject({ id: 'x', size: 5, exports: ['pdf'] });
		expect(toGoogleFile({ id: 'x', name: 'n', size: null })?.size).toBeNull();
		expect(toGoogleFile({ name: 'no id' })).toBeNull();
	});

	it('names what things are', () => {
		expect(isFolder(file({ type: FOLDER_TYPE }))).toBe(true);
		expect(googleKind(file({ type: FOLDER_TYPE }))).toBe('Folder');
		expect(googleKind(file({ type: 'application/vnd.google-apps.document' }))).toBe('Google Doc');
		expect(googleKind(file({ type: 'application/vnd.google-apps.spreadsheet' }))).toBe('Google Sheet');
		expect(googleKind(file())).toBe('PDF file');
		expect(isGoogleDocument(file({ exports: ['docx'] }))).toBe(true);
		expect(isGoogleDocument(file())).toBe(false);
	});

	it('gives exported copies their extension once', () => {
		expect(copyName('Budget', 'docx')).toBe('Budget.docx');
		expect(copyName('Budget.docx', 'docx')).toBe('Budget.docx');
		expect(copyName('notes.txt', '')).toBe('notes.txt');
	});
});
