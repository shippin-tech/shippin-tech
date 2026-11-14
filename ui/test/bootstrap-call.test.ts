import { describe, expect, it } from 'vitest';
import { bootstrapResult, bootstrapSet } from '../src/lib/adapter/bootstrap-call';
import { bootstrapPatch, credentialLines } from '../src/lib/portal/bootstrap';

describe('bootstrap calls', () => {
	it('builds singleton set call and classifies set outcomes', () => {
		expect(bootstrapSet('acct', { hostname: 'mail.example.org' })).toEqual([
			'x:Bootstrap/set',
			{ accountId: 'acct', update: { singleton: { hostname: 'mail.example.org' } } },
			's0'
		]);
		expect(bootstrapResult({ updated: { singleton: {} } })).toBe('saved');
		expect(bootstrapResult({ notUpdated: { singleton: {} } })).toBe('rejected');
		expect(bootstrapResult({})).toBe('missing');
	});

	it('creates patch values and returns credentials only for visible strings', () => {
		const steps = [{ fields: [{ name: 'hostname', kind: 'string' }, { name: 'enabled', kind: 'boolean' }, { name: 'variant', kind: 'choice' }] }];
		const patch = bootstrapPatch(steps, { hostname: 'mx.example.org', enabled: true, variant: 'clustered' });
		expect(patch).toEqual({
			hostname: 'mx.example.org',
			enabled: true,
			variant: { '@type': 'clustered' }
		});
		expect(credentialLines({ username: 'admin', password: 'secret', id: 'singleton' })).toEqual([
			{ label: 'username', value: 'admin' },
			{ label: 'password', value: 'secret' }
		]);
	});
});
