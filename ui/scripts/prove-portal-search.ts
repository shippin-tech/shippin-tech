/**
 * Proves portal command search against the generated catalog.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-search.ts
 */
import { readFileSync } from 'node:fs';
import { layouts, views } from '../src/lib/portal/catalog.ts';
import { buildSearchIndex, querySearch, searchLabel } from '../src/lib/portal/search.ts';

const index = buildSearchIndex(layouts, views);

const domains = querySearch(index, 'domains').find(
	(entry) => entry.type === 'link' && entry.text === 'Domains' && entry.viewName === 'x:Domain'
);
if (!domains) throw new Error('domains page');
if (searchLabel(domains) !== 'List') throw new Error('domains label');

const pyzor = querySearch(index, 'pyzor');
const described = pyzor.find((entry) => entry.type === 'link' && entry.text.includes('Pyzor'));
const section = pyzor.find((entry) => entry.type === 'form' && entry.text === 'Pyzor Settings');
if (!described || !section) throw new Error('pyzor');
if (searchLabel(described) !== 'Settings' || searchLabel(section) !== 'Settings') throw new Error('pyzor label');

const capacity = querySearch(index, 'reservoirCapacity').find(
	(entry) => entry.type === 'field' && entry.text === 'Capacity'
);
if (!capacity) throw new Error('field name');

const ham = querySearch(index, 'learn ham');
if (!ham.some((entry) => entry.text === 'Learn ham from address books')) throw new Error('both tokens');
if (ham.some((entry) => entry.text === 'Learn spam from spam traps')) throw new Error('token missed');

if (querySearch(index, '   ').length !== 0) throw new Error('empty query');
if (querySearch(index, 'zzzz-no-such-page').length !== 0) throw new Error('unknown query');

const broad = querySearch(index, 'e');
if (broad.length !== 15) throw new Error('cap ' + broad.length);
const kinds = broad.map((entry) => entry.type);
if (kinds.indexOf('form') !== -1 && kinds.indexOf('form') < kinds.lastIndexOf('link')) {
	throw new Error('pages come first');
}

const shell = readFileSync(new URL('../src/lib/shippin/admin/AdminShell.svelte', import.meta.url), 'utf8');
const search = readFileSync(new URL('../src/lib/shippin/admin/Search.svelte', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/lib/portal/search.ts', import.meta.url), 'utf8');
for (const sentence of [
	'Search pages, fields, settings...',
	'No results found.',
	'Type to search the admin panel.'
]) {
	if (!search.includes(sentence)) throw new Error('missing ' + sentence);
}
for (const heading of ['Pages', 'Form Sections', 'Fields']) {
	if (!indexSource.includes(heading)) throw new Error('missing ' + heading);
}
if (!search.includes('group.heading')) throw new Error('headings');
if (!search.includes("event.key.toLowerCase() === 'k'")) throw new Error('shortcut');
if (shell.includes("from '$lib/adapter") || search.includes("from '$lib/adapter")) throw new Error('catalog fetches');
if (!shell.includes('Search.svelte')) throw new Error('shell');

console.log('ok');
