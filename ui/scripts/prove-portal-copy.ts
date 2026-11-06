/**
 * Proves the portal copy control.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-copy.ts
 */
import { readFileSync } from 'node:fs';
import { COPY_BLOCKED, COPY_FAILED, COPIED, copyLabel, writeClipboard } from '../src/lib/portal/copy.ts';

if (copyLabel('Domain Name') !== 'Copy Domain Name') throw new Error('named');
if (copyLabel() !== 'Copy') throw new Error('plain');
if (COPIED !== 'Copied') throw new Error('copied');
if (!COPY_FAILED.includes('Copy failed')) throw new Error('failed title');
if (!COPY_BLOCKED.includes('Select the value and copy it manually.')) throw new Error('manual');

let manual = 0;
const copied = await writeClipboard('example.org', {
	secure: true,
	writeText: async () => {},
	execCopy: () => {
		manual += 1;
		return true;
	}
});
if (!copied || manual !== 0) throw new Error('clipboard success');

const fellBack = await writeClipboard('example.org', {
	secure: true,
	writeText: async () => {
		throw new Error('blocked');
	},
	execCopy: (value) => value === 'example.org'
});
if (!fellBack) throw new Error('fallback');

const blocked = await writeClipboard('example.org', {
	secure: false,
	writeText: async () => {},
	execCopy: () => false
});
if (blocked) throw new Error('insecure should block');

const view = readFileSync(new URL('../src/lib/catalog/portal/RecordForm.svelte', import.meta.url), 'utf8');
const button = readFileSync(new URL('../src/lib/catalog/portal/Copy.svelte', import.meta.url), 'utf8');
if (!view.includes('Copy.svelte') || !view.includes('label={field.label}')) throw new Error('form');
for (const binding of ['COPY_FAILED', 'COPY_BLOCKED', 'COPIED']) {
	if (!button.includes(binding)) throw new Error('missing ' + binding);
}
if (view.includes("from '$lib/adapter") || button.includes("from '$lib/adapter")) throw new Error('catalog fetches');

console.log('ok');
