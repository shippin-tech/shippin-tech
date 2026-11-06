/**
 * Proves the portal record slice. Fails if the get call or the view copy drifts.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-records.ts
 */
import { readFileSync } from 'node:fs';
import { cell, registryGet, usingFor } from '../src/lib/adapter/portal-call.ts';

const call = registryGet('x:Domain', 'acct');
if (call[0] !== 'x:Domain/get') throw new Error('method ' + call[0]);
if (call[1].accountId !== 'acct') throw new Error('account');
if (usingFor('x:Domain').length !== 0) throw new Error('registry using');
if (usingFor('Mailbox')[0] !== 'urn:ietf:params:jmap:mail') throw new Error('mail using');
if (cell(true) !== 'true' || cell(null) !== '' || cell(['a', 'b']) !== 'a, b') throw new Error('cell');
if (cell({ '@type': 'Manual' }) !== 'Manual') throw new Error('typed value');

const table = readFileSync(new URL('../src/lib/catalog/portal/RecordTable.svelte', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/lib/catalog/portal/PortalView.svelte', import.meta.url), 'utf8');
if (!table.includes('No results found')) throw new Error('empty copy');
if (!table.includes('href="/login"')) throw new Error('sign-in link');
if (!view.includes('This feature requires an Enterprise license.')) throw new Error('enterprise copy');
if (view.includes("from '$lib/adapter") || table.includes("from '$lib/adapter")) throw new Error('catalog fetches');

const page = readFileSync(
	new URL('../src/routes/(portal)/portal/[...view]/+page.svelte', import.meta.url),
	'utf8'
);
if (!page.includes('loadRegistry')) throw new Error('route does not load');
if (!page.includes('signed-out')) throw new Error('route hides signed-out');

console.log('ok');
