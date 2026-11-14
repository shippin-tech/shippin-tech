/**
 * Proves the bootstrap wizard follows the schema and stays off a normal server.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-bootstrap.ts
 */
import { readFileSync } from 'node:fs';
import { bootstrapResult, bootstrapSet } from '../src/lib/adapter/bootstrap-call.ts';
import { bootstrap } from '../src/lib/portal/catalog.ts';
import {
	CONFIGURED,
	CREDENTIALS,
	EMPTY_FORM,
	FAILED_COMPLETE,
	FAILED_LOAD,
	FINISH,
	INTRO,
	LOADING,
	NO_CONFIRM,
	REQUIRED,
	RESTART,
	WELCOME,
	bootstrapPatch,
	credentialLines,
	stepLabel,
	valuesFromRecord,
	wizardFromGet
} from '../src/lib/portal/bootstrap.ts';

const titles = bootstrap.steps.map((step) => step.title);
if (titles.join('|') !== 'Server Identity|Storage|Account Directory|Logging|Automatic DNS Management') {
	throw new Error('steps ' + titles.join('|'));
}

const names = bootstrap.steps.flatMap((step) => step.fields.map((field) => field.name));
if (names.includes('secret') || names.includes('username')) throw new Error('serverSet leaked');
if (!bootstrap.description.includes('shippin.tech') || bootstrap.description.includes('ShippinTECH')) {
	throw new Error('brand');
}

const identity = bootstrap.steps[0].fields;
const hostname = identity.find((field) => field.name === 'serverHostname');
const tls = identity.find((field) => field.name === 'requestTlsCertificate');
if (hostname?.kind !== 'text' || tls?.kind !== 'boolean') throw new Error('identity kinds');

const storage = bootstrap.steps[1].fields.find((field) => field.name === 'dataStore');
if (!storage || storage.kind !== 'choice' || !storage.options.some((option) => option.value === 'RocksDb' && option.label === 'RocksDB')) {
	throw new Error('data store');
}
const dns = bootstrap.steps[4].fields.find((field) => field.name === 'dnsServer');
if (!dns?.options.some((option) => option.value === 'PowerDns' && option.label === 'PowerDNS Authoritative')) {
	throw new Error('dns');
}

if (wizardFromGet([]) !== 'portal') throw new Error('empty get stays on the portal');
if (wizardFromGet([{ id: 'singleton' }]) !== 'wizard') throw new Error('record opens the wizard');

const values = valuesFromRecord(bootstrap.steps, {
	serverHostname: 'mail.example.org',
	requestTlsCertificate: true,
	dataStore: { '@type': 'RocksDb' }
});
if (values.serverHostname !== 'mail.example.org' || values.requestTlsCertificate !== true || values.dataStore !== 'RocksDb') {
	throw new Error('record values');
}
const patch = bootstrapPatch(bootstrap.steps, values);
if (patch.serverHostname !== 'mail.example.org' || patch.requestTlsCertificate !== true) throw new Error('patch scalars');
if (JSON.stringify(patch.dataStore) !== JSON.stringify({ '@type': 'RocksDb' })) throw new Error('patch choice');
if ('secret' in patch || 'username' in patch) throw new Error('patch serverSet');

const call = bootstrapSet('account', patch);
if (call[0] !== 'x:Bootstrap/set' || !call[1].update || !('singleton' in (call[1].update as object))) {
	throw new Error('set shape');
}
if (bootstrapResult({ updated: { singleton: { secret: 'once' } } }) !== 'saved') throw new Error('saved');
if (bootstrapResult({ notUpdated: { singleton: { type: 'invalid' } } }) !== 'rejected') throw new Error('rejected');
if (bootstrapResult({}) !== 'missing') throw new Error('missing');
const lines = credentialLines({ id: 'singleton', secret: 'once', username: 'admin@example.org', blobId: 'b', '@type': 'x' });
if (lines.map((line) => line.label).join(',') !== 'secret,username') throw new Error('credentials');

if (WELCOME !== 'Welcome to ShippinTECH') throw new Error('welcome');
if (INTRO !== "Let's get your server set up.") throw new Error('intro');
if (stepLabel(1, 5) !== 'Step 1 of 5') throw new Error('step label');
if (FINISH !== 'Finish setup') throw new Error('finish');
for (const sentence of [REQUIRED, FAILED_LOAD, NO_CONFIRM, FAILED_COMPLETE, LOADING, EMPTY_FORM, CREDENTIALS, CONFIGURED, RESTART]) {
	if (!sentence) throw new Error('sentence');
}

const wizard = readFileSync(new URL('../src/lib/shippin/admin/BootstrapWizard.svelte', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/routes/(shippin)/shippin/admin/+layout.svelte', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/routes/(setup)/setup/+page.svelte', import.meta.url), 'utf8');
if (!wizard.includes("from 'bits-ui'") || !wizard.includes('Checkbox') || !wizard.includes('Select')) {
	throw new Error('bits-ui');
}
if (wizard.includes("from '$lib/adapter") || wizard.includes('@xyflow')) throw new Error('catalog fetches');
for (const binding of ['WELCOME', 'INTRO', 'FINISH', 'REQUIRED', 'FAILED_LOAD', 'NO_CONFIRM', 'EMPTY_FORM', 'CREDENTIALS']) {
	if (!wizard.includes(binding)) throw new Error('missing ' + binding);
}
if (!layout.includes('loadBootstrap') || !layout.includes('wizardFromGet') || !layout.includes('BootstrapWizard')) {
	throw new Error('layout');
}
if (setup.includes('saveBootstrap') || setup.includes('x:Bootstrap/set')) throw new Error('setup posts');

console.log('ok');
