export const TITLE = 'Actions';
export const SUBTITLE = 'Execute server management actions';
export const CONFIRM_TITLE = 'Run this action?';
export const EXECUTE = 'Execute';
export const CANCEL = 'Cancel';
export const FAILED_TITLE = 'Action failed';
export const FAILED = 'Action failed.';
export const SUCCESS = 'Action executed successfully.';
export const NO_DATA = 'No additional data returned.';
export const ANOTHER = 'Execute another action';
export const BACK = 'Back to actions';
export const REQUIRED = 'This field is required.';
export const OTHER = 'Other';
export const RUNNING = 'Running action...';
export const SIGN_IN_REQUIRED = 'Sign in to run actions.';

export type ActionItem = { name: string; label: string; schema: string };
export type ActionResult = 'saved' | 'rejected' | 'missing';

export function actionGroups(items: readonly ActionItem[]): { label: string; actions: ActionItem[] }[] {
	const groups = new Map<string, ActionItem[]>();
	for (const item of items) {
		const parts = item.label.split(': ');
		const label = parts.length > 1 ? parts[0] : OTHER;
		groups.set(label, [...(groups.get(label) ?? []), item]);
	}
	return [...groups].map(([label, actions]) => ({ label, actions }));
}

export function actionNotice(result: ActionResult, label: string): string {
	if (result === 'saved') return `${label}: ${SUCCESS}`;
	if (result === 'rejected') return `${label}: ${FAILED}`;
	return `${label}: ${NO_DATA}`;
}
