import { describe, expect, it } from 'vitest';
import { nextAfterDiscover } from '../src/lib/adapter/discover-call';
import { classifyMetrics } from '../src/lib/adapter/metrics-call';
import { cell, registryGet, usingFor } from '../src/lib/adapter/portal-call';
import { COPY_BLOCKED, copyLabel, writeClipboard } from '../src/lib/portal/copy';
import { recordPatch, type PortalSchema } from '../src/lib/portal/schema';
import { views } from '../src/lib/portal/catalog';
import { buildSearchIndex, querySearch, searchLabel } from '../src/lib/portal/search';

describe('catalog field types', () => {
	it('keeps a string, a boolean, a secret, and a color from the schema', () => {
		const domain = views['x:Domain'].sections[0].fields;
		expect(domain[0]).toMatchObject({ name: 'name', type: 'string', format: 'string' });
		expect(domain[2]).toMatchObject({ name: 'isEnabled', type: 'boolean', format: '' });
		const client = views['x:OAuthClient'].sections[0].fields;
		expect(client[5]).toMatchObject({ name: 'secret', type: 'string', format: 'secret' });
		const calendar = views.Calendar.sections[0].fields;
		expect(calendar[2]).toMatchObject({ name: 'color', type: 'string', format: 'color' });
	});
});

describe('copy', () => {
	it('names the field and falls back when the clipboard rejects the write', async () => {
		expect(copyLabel('Domain Name')).toBe('Copy Domain Name');
		const ok = await writeClipboard('example.org', {
			secure: true,
			writeText: async () => {
				throw new Error('blocked');
			},
			execCopy: (value) => value === 'example.org'
		});
		expect(ok).toBe(true);
		expect(COPY_BLOCKED).toContain('Select the value and copy it manually.');
	});
});

describe('search', () => {
	const index = buildSearchIndex(
		[{ name: 'Management', items: [{ name: 'Domains', view: '', children: [{ name: 'Domains', view: 'x:Domain' }] }] }],
		{
			'x:Domain': {
				kind: 'object',
				description: 'Defines an email domain.',
				sections: [{ title: 'Domain', fields: [{ name: 'name', label: 'Domain Name' }] }]
			}
		}
	);

	it('matches a page and a field, and returns nothing for a blank query', () => {
		const pages = querySearch(index, 'domains');
		const page = pages.find((entry) => entry.type === 'link' && entry.text === 'Domains');
		expect(page).toBeDefined();
		expect(searchLabel(page!)).toBe('List');
		expect(querySearch(index, 'name').some((entry) => entry.text === 'Domain Name')).toBe(true);
		expect(querySearch(index, '   ')).toEqual([]);
	});
});

describe('registry calls', () => {
	it('skips using for an x object and classifies metrics', () => {
		expect(usingFor('x:Domain')).toEqual([]);
		expect(usingFor('Mailbox')[0]).toBe('urn:ietf:params:jmap:mail');
		expect(registryGet('x:Domain', 'acct')[0]).toBe('x:Domain/get');
		expect(cell({ '@type': 'Manual' })).toBe('Manual');
		expect(classifyMetrics(404)).toBe('rejected');
		expect(classifyMetrics(200)).toBe('ready');
	});
});

describe('discover', () => {
	it('asks a local login document with no client id to register', () => {
		const next = nextAfterDiscover({
			document: { authorization_endpoint: '/login', scopes_supported: ['openid'] },
			username: 'admin@example.org',
			metaClientId: null,
			origin: 'http://127.0.0.1:5175',
			basePath: '',
			apiOrigin: 'http://127.0.0.1:5175'
		});
		expect(next.step).toBe('register');
	});
});

describe('schema record writes', () => {
	it('preserves nested values and excludes server-owned and immutable update properties', () => {
		const schema = { fields: { example: { properties: {
			config: { type: { type: 'object' }, update: 'mutable' },
			id: { type: { type: 'string' }, update: 'serverSet' },
			name: { type: { type: 'string' }, update: 'immutable' }
		} } } } as unknown as PortalSchema;
		const original = { id: 'one', name: 'fixed', config: { '@type': 'Manual' } };
		const draft = { id: 'changed', name: 'changed', config: { '@type': 'Automatic', nested: ['one', 'two'] } };
		expect(recordPatch(schema, 'example', original, draft, false)).toEqual({ config: draft.config });
		expect(recordPatch(schema, 'example', {}, draft, true)).toEqual({ name: 'changed', config: draft.config });
	});
});
