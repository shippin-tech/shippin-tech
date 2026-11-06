export const WELCOME = 'Welcome to ShippinTECH';
export const INTRO = "Let's get your server set up.";
export const BACK = 'Back';
export const NEXT = 'Next';
export const FINISH = 'Finish setup';
export const REQUIRED = 'This field is required.';
export const FAILED_LOAD = 'Failed to load bootstrap state.';
export const NO_CONFIRM = 'The server did not confirm the update.';
export const FAILED_COMPLETE = 'Failed to complete setup.';
export const LOADING = 'Loading setup...';
export const EMPTY_FORM = 'Setup form is empty. The server did not return any bootstrap fields.';
export const COMPLETE = 'Setup complete';
export const CREDENTIALS =
	'Your administrator account has been created. Write these down now: the password will not be shown again.';
export const CONFIGURED = 'ShippinTECH has been configured successfully.';
export const NEXT_STEP = 'Next step:';
export const RESTART =
	'restart ShippinTECH for the new configuration to take effect. Once restarted, sign in with the credentials above to continue administering your server.';

const HIDDEN = new Set(['id', 'blobId', '@type']);

type Step = { fields: readonly { name: string; kind: string }[] };

export type FinishResult = {
	status: 'saved' | 'rejected' | 'missing';
	credentials?: { label: string; value: string }[];
};

export function stepLabel(current: number, total: number): string {
	return `Step ${current} of ${total}`;
}

export function wizardFromGet(list: readonly unknown[]): 'wizard' | 'portal' {
	return list.length > 0 ? 'wizard' : 'portal';
}

export function emptyValues(steps: readonly Step[]): Record<string, string | boolean> {
	const values: Record<string, string | boolean> = {};
	for (const step of steps) {
		for (const field of step.fields) values[field.name] = field.kind === 'boolean' ? false : '';
	}
	return values;
}

export function valuesFromRecord(
	steps: readonly Step[],
	record: Record<string, unknown>
): Record<string, string | boolean> {
	const values = emptyValues(steps);
	for (const step of steps) {
		for (const field of step.fields) {
			const raw = record[field.name];
			if (field.kind === 'boolean') values[field.name] = raw === true;
			else if (field.kind === 'choice' && raw && typeof raw === 'object' && typeof (raw as { '@type'?: unknown })['@type'] === 'string') {
				values[field.name] = (raw as { '@type': string })['@type'];
			} else if (typeof raw === 'string') values[field.name] = raw;
		}
	}
	return values;
}

export function bootstrapPatch(steps: readonly Step[], values: Record<string, string | boolean>): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const step of steps) {
		for (const field of step.fields) {
			const value = values[field.name];
			if (field.kind === 'choice' && typeof value === 'string' && value) patch[field.name] = { '@type': value };
			else if (field.kind === 'boolean') patch[field.name] = value === true;
			else if (typeof value === 'string') patch[field.name] = value;
		}
	}
	return patch;
}

export function credentialLines(record: Record<string, unknown>): { label: string; value: string }[] {
	return Object.entries(record).flatMap(([label, value]) => {
		if (HIDDEN.has(label) || typeof value !== 'string' || value.length === 0) return [];
		return [{ label, value }];
	});
}
