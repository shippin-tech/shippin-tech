/** Pure helpers for masked addresses; the calls are in adapter/masked.ts. */

export type MaskedAddress = { address: string; accountId: number; label: string; enabled: boolean; createdAt: number };

export function maskedLocal(address: string): string {
	return address.split('@')[0];
}

export function maskedName(item: Pick<MaskedAddress, 'label'>): string {
	return item.label.trim() || 'No label';
}

export function maskedCount(used: number, limit: number): string {
	return `${used} of ${limit} used`;
}

export function maskedStatus(enabled: boolean): string {
	return enabled ? 'Delivering to your Inbox' : 'Switched off. Mail to it is refused.';
}
