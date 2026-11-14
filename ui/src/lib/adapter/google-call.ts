/** Pure helpers for the Google Drive link; the calls are in adapter/google.ts. */

export const FOLDER_TYPE = 'application/vnd.google-apps.folder';
export const IMPORT_FOLDER = 'From Google';

export type GoogleStatus = { available: boolean; connected: boolean; email: string | null };

export type GoogleFile = {
	id: string;
	name: string;
	type: string;
	size: number | null;
	modified: string;
	webLink: string;
	exports: string[];
};

export type GoogleListing = { files: GoogleFile[]; nextPage: string | null };

export const EXPORT_LABELS: Record<string, string> = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', pdf: 'PDF' };

export function parseStatus(body: unknown): GoogleStatus {
	const raw = (body ?? {}) as Record<string, unknown>;
	return { available: raw.available === true, connected: raw.connected === true, email: typeof raw.email === 'string' ? raw.email : null };
}

export function toGoogleFile(raw: Record<string, unknown>): GoogleFile | null {
	if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
	return {
		id: raw.id,
		name: raw.name,
		type: typeof raw.type === 'string' ? raw.type : '',
		size: typeof raw.size === 'number' ? raw.size : null,
		modified: typeof raw.modified === 'string' ? raw.modified : '',
		webLink: typeof raw.webLink === 'string' ? raw.webLink : '',
		exports: Array.isArray(raw.exports) ? raw.exports.filter((item): item is string => typeof item === 'string') : []
	};
}

export function isFolder(file: GoogleFile): boolean {
	return file.type === FOLDER_TYPE;
}

/** Google's own Docs, Sheets and Slides have no file to fetch; they are exported. */
export function isGoogleDocument(file: GoogleFile): boolean {
	return file.exports.length > 0;
}

export function googleKind(file: GoogleFile): string {
	if (isFolder(file)) return 'Folder';
	const app = /^application\/vnd\.google-apps\.(\w+)$/.exec(file.type)?.[1];
	if (app) return { document: 'Google Doc', spreadsheet: 'Google Sheet', presentation: 'Google Slides', drawing: 'Google Drawing' }[app] ?? 'Google file';
	const dot = file.name.lastIndexOf('.');
	const extension = dot > 0 ? file.name.slice(dot + 1).toUpperCase() : '';
	return extension && extension.length <= 5 ? `${extension} file` : 'File';
}

/** The name a copy should have: an exported Google Doc takes the extension it was exported to. */
export function copyName(name: string, extension: string): string {
	return extension && !name.toLowerCase().endsWith(`.${extension}`) ? `${name}.${extension}` : name;
}
