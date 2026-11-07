/**
 * Checks registry payload and response contracts. Real persistence is checked by prove-portal-records.mjs.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-writes.ts
 */
import { registrySet, setResult } from '../src/lib/adapter/writes-call.ts';
import {
	NOT_CONFIRMED,
	NO_CHANGES,
	createLabel,
	deleteDescription,
	deleteItem,
	deleteTitle,
	deletedSuccess,
	writeNotice
} from '../src/lib/portal/writes.ts';

if (createLabel('Domain') !== 'Create Domain') throw new Error('create');
if (deleteTitle('Domain') !== 'Delete Domain?') throw new Error('delete title');
if (deleteItem('example.org') !== 'Are you sure you want to delete example.org? This action cannot be undone.') {
	throw new Error('delete item');
}
if (deleteDescription('Domain') !== 'This action cannot be undone. This will permanently delete this Domain.') {
	throw new Error('delete description');
}
if (deletedSuccess('Domain') !== 'Domain deleted successfully') throw new Error('deleted');
if (writeNotice('unchanged') !== NO_CHANGES) throw new Error('no changes');
if (writeNotice('missing') !== NOT_CONFIRMED) throw new Error('not confirmed');
if (writeNotice('rejected', 'Domain', true) !== 'Failed to delete.') throw new Error('failed delete');
if (writeNotice('saved') !== 'Saved successfully') throw new Error('saved');

const created = registrySet('x:Domain', 'acct', { create: { c1: { name: 'example.org' } } });
if (created[0] !== 'x:Domain/set' || created[1].accountId !== 'acct') throw new Error('create call');
const updated = registrySet('x:Domain', 'acct', { update: { d1: { name: 'example.org' } } });
if (!updated[1].update || !('d1' in (updated[1].update as object))) throw new Error('update call');
const destroyed = registrySet('x:Domain', 'acct', { destroy: ['d1'] });
if (JSON.stringify(destroyed[1].destroy) !== JSON.stringify(['d1'])) throw new Error('destroy call');
if (setResult({ destroyed: ['d1'] }, 'd1') !== 'saved') throw new Error('destroyed');
if (setResult({ notDestroyed: { d1: { type: 'forbidden' } } }, 'd1') !== 'rejected') throw new Error('rejected');
if (setResult({}, 'd1') !== 'missing') throw new Error('missing');

console.log('Registry call contracts passed. Real persistence: node scripts/prove-portal-records.mjs');
