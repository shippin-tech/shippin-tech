export const SAVE = 'Save';
export const CANCEL = 'Cancel';
export const DELETE = 'Delete';
export const NO_CHANGES = 'No changes to save';
export const NOT_CONFIRMED = 'The server did not confirm the change.';
export const SAVED = 'Saved successfully';
export const CREATED = 'Created successfully';
export const FAILED_SAVE = 'Failed to save.';
export const FAILED_DELETE = 'Failed to delete.';

export function objectLabel(name: string): string {
	const parts = name.replace(/^x:/, '').split('/');
	return parts[parts.length - 1] || name;
}

export function createLabel(name: string): string {
	return `Create ${name}`;
}

export function deleteTitle(name: string): string {
	return `Delete ${name}?`;
}

export function deleteItem(label: string): string {
	return `Are you sure you want to delete ${label}? This action cannot be undone.`;
}

export function deleteDescription(name: string): string {
	return `This action cannot be undone. This will permanently delete this ${name}.`;
}

export function deletedSuccess(name: string): string {
	return `${name} deleted successfully`;
}

export type WriteResult = 'saved' | 'rejected' | 'missing' | 'unchanged';

export function writeNotice(result: WriteResult, name = '', destroyed = false): string {
	if (result === 'unchanged') return NO_CHANGES;
	if (result === 'saved') return destroyed ? deletedSuccess(name) : SAVED;
	if (result === 'rejected') return destroyed ? FAILED_DELETE : FAILED_SAVE;
	return NOT_CONFIRMED;
}
