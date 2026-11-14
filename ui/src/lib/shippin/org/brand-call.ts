/** Pure helpers for domain logos; the calls are in shippin/org/brand.ts. */

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_LOGO_BYTES = 90_000;

/** The domain of an address, once it looks finished. Empty otherwise. */
export function emailDomain(address: string): string {
	const match = /^[^@\s]+@([^@\s]+\.[a-z]{2,})$/i.exec(address.trim());
	return match ? match[1].toLowerCase() : '';
}

export function logoUrl(domain: string, version = 0): string {
	const base = `/api/brand/${encodeURIComponent(domain)}`;
	return version ? `${base}?v=${version}` : base;
}

export function logoFileProblem(file: Pick<File, 'type' | 'size'>): string {
	if (!LOGO_TYPES.includes(file.type) || file.size > MAX_LOGO_BYTES) return 'Use a PNG, JPEG or WebP image under 90 KB.';
	return '';
}
