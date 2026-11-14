import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeReturnPath, rememberReturnPath } from '../src/lib/adapter/session';

type StorageState = Record<string, string>;

function mockStorage(initial: StorageState = {}): Storage {
	const state: StorageState = { ...initial };
	return {
		getItem: (key) => (key in state ? state[key] : null),
		setItem: (key, value) => {
			state[key] = String(value);
		},
		removeItem: (key) => {
			delete state[key];
		},
		clear: () => {
			for (const key of Object.keys(state)) delete state[key];
		},
		key: (index) => Object.keys(state)[index] ?? null,
		get length() {
			return Object.keys(state).length;
		}
	};
}

describe('session return navigation', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stores a safe return path and consumes it once', () => {
		vi.stubGlobal('window', { location: { origin: 'https://shippin.tech' } });
		vi.stubGlobal('sessionStorage', mockStorage());
		rememberReturnPath('/mail?folder=inbox');
		expect(consumeReturnPath('/shippin/admin')).toBe('/mail?folder=inbox');
		expect(consumeReturnPath('/shippin/admin')).toBe('/shippin/admin');
	});

	it('ignores unsafe or malformed return paths', () => {
		vi.stubGlobal('window', { location: { origin: 'https://shippin.tech' } });
		vi.stubGlobal('sessionStorage', mockStorage());
		rememberReturnPath('https://evil.example');
		expect(consumeReturnPath('/shippin/admin')).toBe('/shippin/admin');
		rememberReturnPath('//evil.example');
		expect(consumeReturnPath('/shippin/admin')).toBe('/shippin/admin');
	});
});
