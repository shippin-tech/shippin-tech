/** Pure helpers for the Keys page; the calls are in keys-admin.ts. Never holds a key's bytes. */

export type ServiceName = 'ai' | 'sso' | 'google' | 'domain-proof';

export type KeyView = {
	id: number;
	origin: 'generated' | 'yours';
	kept: 'stored' | 'environmentVariable' | 'file';
	place: string | null;
	state: 'primary' | 'decryptOnly';
	created: number;
	readable: boolean;
};

export type ServiceKeys = { service: ServiceName; keys: KeyView[] };

export type KeysReport = {
	services: ServiceKeys[];
	wrapping: { path: string; madeHere: boolean; readable: boolean };
};

export type Replaced = { id: number; resealed: number; failed: number; retired: number };

export type NewKeyDraft = { from: 'random' | 'value' | 'environmentVariable' | 'file'; value: string; name: string; path: string };

export const SERVICES: Record<ServiceName, { name: string; job: string }> = {
	ai: { name: 'AI provider key', job: 'Seals the AI provider key an administrator pastes, and nothing else.' },
	sso: { name: 'Sign-in secrets', job: 'Seals each domain’s sign-in client secret, and nothing else.' },
	google: { name: 'Google link', job: 'Seals the Google tokens kept for people who connected Drive, and nothing else.' },
	'domain-proof': {
		name: 'Domain proof',
		job: 'Signs the DNS value a free-plan owner publishes to prove a domain. It seals nothing. Replaced keys are kept, so a value already published still counts.'
	}
};

export function emptyDraft(): NewKeyDraft {
	return { from: 'random', value: '', name: '', path: '' };
}

export function keyText(key: KeyView): string {
	const origin = key.origin === 'generated' ? 'made at random by this server' : 'yours';
	const kept =
		key.kept === 'stored'
			? 'kept in the database, wrapped by the key-wrapping key'
			: key.kept === 'environmentVariable'
				? `read from the environment variable ${key.place}`
				: `read from the file ${key.place}`;
	const state = key.state === 'primary' ? 'In use.' : 'Replaced: opens only what it sealed, until that is sealed again.';
	const readable = key.readable ? '' : ' The server cannot read it right now.';
	return `Key ${key.id}: ${origin}, ${kept}. ${state}${readable}`;
}

export function missingServices(report: KeysReport): ServiceName[] {
	return report.services.filter((item) => !item.keys.some((key) => key.state === 'primary')).map((item) => item.service);
}

const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;

/** What is wrong with a draft, in words, before it is sent. */
export function newKeyProblem(draft: NewKeyDraft): string {
	if (draft.from === 'value' && !BASE64_KEY.test(draft.value.trim())) {
		return 'A key is 32 bytes written as base64: 44 characters ending in =.';
	}
	if (draft.from === 'environmentVariable' && !VARIABLE.test(draft.name.trim())) {
		return 'Enter the name of an environment variable, such as SHIPPIN_AI_KEY.';
	}
	if (draft.from === 'file' && !draft.path.trim().startsWith('/')) {
		return 'Enter the full path of the file, starting with /.';
	}
	return '';
}

export function newKeyBody(draft: NewKeyDraft): Record<string, string> {
	switch (draft.from) {
		case 'value':
			return { from: 'value', value: draft.value.trim() };
		case 'environmentVariable':
			return { from: 'environmentVariable', name: draft.name.trim() };
		case 'file':
			return { from: 'file', path: draft.path.trim() };
		default:
			return { from: 'random' };
	}
}

export function replacedText(service: ServiceName, done: Replaced): string {
	const sealed = done.resealed === 1 ? '1 value was sealed again' : `${done.resealed} values were sealed again`;
	const failed = done.failed ? ` ${done.failed} could not be read, so the old key is kept for now.` : '';
	const retired = done.retired ? ' The old key was destroyed.' : '';
	return `${SERVICES[service].name}: key ${done.id} is in use. ${sealed}.${failed}${retired}`;
}
