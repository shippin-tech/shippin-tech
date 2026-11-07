/**
 * Proves the action list and action posting wiring.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-actions.ts
 */
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

const parameters = { remoteIp: '127.0.0.1', envRcptTo: { 'admin@local.test': true } };
const parameterized = actionSet('acct', 'ClassifySpam', parameters);
const body = (parameterized[1].create as Record<string, Record<string, unknown>>).a0;
if (body['@type'] !== 'ClassifySpam' || body.envRcptTo !== parameters.envRcptTo) throw new Error('parameters');

console.log('Action call contracts passed. Real execution: node scripts/prove-portal-records.mjs');
