export function tlsRecordUrl(object: string, id = ''): string {
	return `/shippin/admin/${object}${id ? `?id=${encodeURIComponent(id)}` : ''}`;
}

export function certificateStatus(record: Record<string, unknown>, now = Date.now()): string {
	const before = typeof record.notValidBefore === 'string' ? Date.parse(record.notValidBefore) : NaN;
	const after = typeof record.notValidAfter === 'string' ? Date.parse(record.notValidAfter) : NaN;
	if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return 'Validity dates unavailable';
	if (now < before) return 'Not yet valid';
	if (now >= after) return 'Expired';
	return 'Within validity dates';
}

export function certificateNames(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Not reported';
	const names = Object.keys(value).filter((name) => (value as Record<string, unknown>)[name] === true);
	return names.length ? names.join(', ') : 'Not reported';
}

export function certificateManagement(value: unknown, providers: Record<string, unknown>[]): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Not configured';
	const management = value as Record<string, unknown>;
	if (management['@type'] === 'Manual') return 'Manual';
	if (management['@type'] !== 'Automatic') return 'Not configured';
	const provider = providers.find((item) => item.id === management.acmeProviderId);
	return provider
		? `Automatic: ${String(provider.description ?? provider.directory ?? provider.id)}`
		: 'Automatic: provider unavailable';
}
