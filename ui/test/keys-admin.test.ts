import { describe, expect, it } from 'vitest';
import {
	SERVICES,
	emptyDraft,
	keyText,
	missingServices,
	newKeyBody,
	newKeyProblem,
	replacedText,
	type KeyView,
	type KeysReport
} from '../src/lib/shippin/keys/keys-admin-call';

const key = (over: Partial<KeyView>): KeyView => ({ id: 1, origin: 'generated', kept: 'stored', place: null, state: 'primary', created: 0, readable: true, ...over });

describe('the keys page', () => {
	it('names every service and its one job', () => {
		expect(Object.keys(SERVICES).sort()).toEqual(['ai', 'domain-proof', 'google', 'sso']);
		for (const service of Object.values(SERVICES)) expect(service.job.length).toBeGreaterThan(20);
	});

	it('describes a key without its bytes: where it came from, where it is kept, what it does', () => {
		expect(keyText(key({}))).toBe('Key 1: made at random by this server, kept in the database, wrapped by the key-wrapping key. In use.');
		expect(keyText(key({ id: 2, origin: 'yours', kept: 'file', place: '/run/secrets/ai', state: 'decryptOnly' }))).toBe(
			'Key 2: yours, read from the file /run/secrets/ai. Replaced: opens only what it sealed, until that is sealed again.'
		);
		expect(keyText(key({ kept: 'environmentVariable', place: 'AI_KEY', readable: false }))).toMatch(/environment variable AI_KEY\. In use\. The server cannot read it right now\.$/);
	});

	it('finds the services that still need a key', () => {
		const report: KeysReport = {
			services: [
				{ service: 'ai', keys: [key({})] },
				{ service: 'sso', keys: [] },
				{ service: 'google', keys: [key({ state: 'decryptOnly' })] },
				{ service: 'domain-proof', keys: [key({})] }
			],
			wrapping: { path: '/var/lib/shippin.tech/key-wrapping.key', madeHere: true, readable: true }
		};
		expect(missingServices(report)).toEqual(['sso', 'google']);
	});

	it('checks a new key before sending it, and sends only what its source needs', () => {
		const pasted = 'A'.repeat(43) + '=';
		expect(newKeyProblem(emptyDraft())).toBe('');
		expect(newKeyProblem({ ...emptyDraft(), from: 'value', value: 'short' })).toMatch(/44 characters/);
		expect(newKeyProblem({ ...emptyDraft(), from: 'value', value: ` ${pasted} ` })).toBe('');
		expect(newKeyProblem({ ...emptyDraft(), from: 'environmentVariable', name: '1X' })).toMatch(/environment variable/);
		expect(newKeyProblem({ ...emptyDraft(), from: 'file', path: 'key' })).toMatch(/starting with \//);
		expect(newKeyBody(emptyDraft())).toEqual({ from: 'random' });
		expect(newKeyBody({ from: 'value', value: ` ${pasted} `, name: 'X', path: '/p' })).toEqual({ from: 'value', value: pasted });
		expect(newKeyBody({ from: 'file', value: 'secret', name: 'X', path: ' /run/k ' })).toEqual({ from: 'file', path: '/run/k' });
	});

	it('says what replacing a key did', () => {
		expect(replacedText('ai', { id: 3, resealed: 1, failed: 0, retired: 1 })).toBe('AI provider key: key 3 is in use. 1 value was sealed again. The old key was destroyed.');
		expect(replacedText('google', { id: 2, resealed: 4, failed: 1, retired: 0 })).toBe(
			'Google link: key 2 is in use. 4 values were sealed again. 1 could not be read, so the old key is kept for now.'
		);
	});
});
