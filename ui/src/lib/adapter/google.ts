import { authorization } from './session';
import { createFolder, listFolder, uploadFile, type DriveNode } from './drive';
import { IMPORT_FOLDER, copyName, parseStatus, toGoogleFile, type GoogleFile, type GoogleListing, type GoogleStatus } from './google-call';

export * from './google-call';

function headers(): Record<string, string> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	return { Authorization: auth };
}

async function failure(res: Response, fallback: string): Promise<Error> {
	const body = (await res.json().catch(() => ({}))) as { message?: unknown };
	return new Error(typeof body.message === 'string' && body.message ? body.message : fallback);
}

export async function googleStatus(): Promise<GoogleStatus> {
	const res = await fetch('/api/google', { credentials: 'same-origin', cache: 'no-store', headers: headers() });
	if (!res.ok) throw await failure(res, 'The Google link could not be checked.');
	return parseStatus(await res.json());
}

/** Sends the browser to Google; it comes back to /files?view=google. */
export async function connectGoogle(): Promise<void> {
	const res = await fetch('/api/google/connect', { method: 'POST', credentials: 'same-origin', headers: headers() });
	if (!res.ok) throw await failure(res, 'Google could not be reached.');
	const body = (await res.json()) as { url?: unknown };
	if (typeof body.url !== 'string') throw new Error('Google could not be reached.');
	window.location.href = body.url;
}

export async function disconnectGoogle(): Promise<void> {
	const res = await fetch('/api/google/disconnect', { method: 'POST', credentials: 'same-origin', headers: headers() });
	if (!res.ok) throw await failure(res, 'The link could not be removed.');
}

export async function listGoogle(options: { folder?: string; search?: string; shared?: boolean; page?: string }): Promise<GoogleListing> {
	const params = new URLSearchParams();
	if (options.folder) params.set('folder', options.folder);
	if (options.search?.trim()) params.set('search', options.search.trim());
	if (options.shared) params.set('shared', '1');
	if (options.page) params.set('pageToken', options.page);
	const res = await fetch(`/api/google/files?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store', headers: headers() });
	if (!res.ok) throw await failure(res, 'Your Google files could not be loaded.');
	const body = (await res.json()) as { files?: Record<string, unknown>[]; nextPage?: unknown };
	return {
		files: (body.files ?? []).flatMap((raw) => toGoogleFile(raw) ?? []),
		nextPage: typeof body.nextPage === 'string' ? body.nextPage : null
	};
}

async function fetchContent(file: GoogleFile, format?: string): Promise<File> {
	const query = format ? `?export=${encodeURIComponent(format)}` : '';
	const res = await fetch(`/api/google/content/${encodeURIComponent(file.id)}${query}`, { credentials: 'same-origin', headers: headers() });
	if (!res.ok) throw await failure(res, `${file.name} could not be fetched from Google.`);
	const blob = await res.blob();
	const name = copyName(file.name, res.headers.get('X-File-Extension') ?? '');
	return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

/** Saves a Google file to this device. */
export async function downloadGoogle(file: GoogleFile, format?: string): Promise<void> {
	const content = await fetchContent(file, format);
	const link = document.createElement('a');
	link.href = URL.createObjectURL(content);
	link.download = content.name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Copies a Google file into the "From Google" folder of the person's own Drive. */
export async function importFromGoogle(file: GoogleFile, format?: string): Promise<void> {
	const content = await fetchContent(file, format);
	const top = await listFolder(null);
	const folder = top.find((node) => node.kind === 'folder' && node.name === IMPORT_FOLDER)?.id ?? (await createFolder(null, IMPORT_FOLDER));
	await uploadFile(content, folder, () => undefined);
}

/** Puts a copy of one of the person's Drive files in their Google Drive. */
export async function copyToGoogle(node: DriveNode): Promise<void> {
	const res = await fetch('/api/google/copy', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { ...headers(), 'Content-Type': 'application/json' },
		body: JSON.stringify({ blobId: node.blobId, name: node.name, type: node.type })
	});
	if (!res.ok) throw await failure(res, `${node.name} could not be copied to Google.`);
}
