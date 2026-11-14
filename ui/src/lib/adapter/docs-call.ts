/**
 * Pure helpers for Docs. A document is an ordinary HTML file in Drive whose name ends
 * in `.shdoc.html`, so sharing, storage limits and WebDAV all apply to it unchanged.
 */
import { nameProblem } from './drive-call';

export const DOC_SUFFIX = '.shdoc.html';
export const DOC_TYPE = 'text/html';
export const DOC_FOLDER = 'Documents';
export const UNTITLED = 'Untitled document';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict';

export const SAVE_LABELS: Record<SaveState, string> = {
	saved: 'Saved',
	unsaved: 'Unsaved changes',
	saving: 'Saving…',
	failed: 'Could not save. Trying again when you next type.',
	conflict: 'Someone else changed this document.'
};

export function isDocName(name: string): boolean {
	return name.toLowerCase().endsWith(DOC_SUFFIX);
}

export function docTitle(name: string): string {
	return isDocName(name) ? name.slice(0, -DOC_SUFFIX.length) : name;
}

export function docFileName(title: string): string {
	return `${title.trim() || UNTITLED}${DOC_SUFFIX}`;
}

export function titleProblem(title: string): string {
	return title.trim() ? nameProblem(docFileName(title)) : 'Give the document a title.';
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The stored file: a complete HTML page, so it opens in anything that reads HTML. */
export function wrapDocument(title: string, body: string): string {
	return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/** The editable part of a stored file. The editor parses it against its schema, which drops anything else. */
export function bodyOf(html: string): string {
	const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
	return (match ? match[1] : html).trim();
}

/** A page Word opens as a document. */
export function wordDocument(title: string, body: string): string {
	return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/** An address for a link, or null when it is not one we allow. */
export function safeLink(input: string): string | null {
	const text = input.trim();
	if (!text || /\s/.test(text)) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(withScheme);
		return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

/** A file name for an export: the title without characters file systems refuse. */
export function exportName(title: string, extension: string): string {
	return `${title.replace(/[/<>:"\\|?*]/g, ' ').trim() || UNTITLED}.${extension}`;
}
