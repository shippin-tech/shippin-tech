/**
 * Proves the action list and that the page does not post the set.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-actions.ts
 */
import { readFileSync } from 'node:fs';
import { actionResult, actionSet } from '../src/lib/adapter/action-call.ts';
import { FAILED, REQUIRED, actionGroups } from '../src/lib/portal/actions.ts';
import { actions } from '../src/lib/portal/catalog.ts';

if (actions.length !== 11) throw new Error('count ' + actions.length);
const reload = actions.find((item) => item.name === 'ReloadSettings');
if (reload?.label !== 'Reload: Server settings') throw new Error('reload');
const dmarc = actions.find((item) => item.name === 'TroubleshootDmarc');
if (dmarc?.schema !== 'x:DmarcTroubleshoot') throw new Error('dmarc');
const groups = actionGroups(actions);
if (!groups.some((group) => group.label === 'Reload' && group.actions.length === 4)) throw new Error('group');
if (REQUIRED !== 'This field is required.' || FAILED !== 'Action failed.') throw new Error('copy');

const call = actionSet('acct', 'ReloadSettings');
if (call[0] !== 'x:Action/set') throw new Error('method');
const create = (call[1] as { create?: Record<string, { '@type'?: string }> }).create?.a0;
if (create?.['@type'] !== 'ReloadSettings') throw new Error('create');
if (actionResult({ created: { a0: { id: '1' } } }, 'a0') !== 'saved') throw new Error('saved');
if (actionResult({ notCreated: { a0: { type: 'forbidden' } } }, 'a0') !== 'rejected') throw new Error('rejected');
if (actionResult({}, 'a0') !== 'missing') throw new Error('missing');

const panel = readFileSync(new URL('../src/lib/catalog/portal/ActionPanel.svelte', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/routes/(portal)/portal/[...view]/+page.svelte', import.meta.url), 'utf8');
if (!panel.includes('CONFIRM_TITLE') || !panel.includes('EXECUTE') || !panel.includes('FAILED')) {
	throw new Error('bindings');
}
if (panel.includes("from '$lib/adapter") || panel.includes('/set') || panel.includes('actionSet')) {
	throw new Error('panel posts');
}
if (!page.includes('ActionPanel') || !page.includes("id === 'x:Action'")) throw new Error('route');
if (page.includes('actionSet') || page.includes('x:Action/set')) throw new Error('route posts');

console.log('ok');
