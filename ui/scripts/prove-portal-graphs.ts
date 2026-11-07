/**
 * Checks optional graph data. Graphs are not the working portal or delivery runner.
 * Run from ui/: node --experimental-strip-types scripts/prove-portal-graphs.ts
 */
import { readFileSync } from 'node:fs';
import { deliveryNodes } from '../src/lib/flow/delivery/phases.ts';
import { layoutGraph } from '../src/lib/flow/portal/graph.ts';
import { layouts } from '../src/lib/portal/catalog.ts';

const management = layoutGraph(layouts, 'Management');
const domains = management.find((node) => node.label === 'Domains' && node.href === '/portal/x:Domain');
if (!domains || domains.parent !== 'Management:Domains') throw new Error('domains node');
if (management.some((node) => node.href.startsWith('/mail'))) throw new Error('shell link');

const settings = layoutGraph(layouts, 'Settings');
const account = layoutGraph(layouts, 'Account');
if (settings.length < 2 || account.length < 2) throw new Error('layout graph');
const all = [...management, ...settings, ...account];
if (new Set(all.map((node) => node.id)).size !== all.length) throw new Error('node ids collapsed');
if (all.some((node) => !node.href.startsWith('/portal'))) throw new Error('node leaves the portal');

const lookup = deliveryNodes.find((node) => node.label === 'MX Lookup');
const connection = deliveryNodes.find((node) => node.label === 'TCP Connection');
if (!lookup || lookup.parent) throw new Error('mx lookup');
if (!connection || connection.parent !== 'ip-lookup') throw new Error('tcp connection');
if (deliveryNodes.some((node) => node.href !== '/portal/CustomComponent/LiveDelivery')) {
	throw new Error('delivery href');
}

const graph = readFileSync(new URL('../src/lib/flow/Graph.svelte', import.meta.url), 'utf8');
if (!graph.includes('item.parent') || !graph.includes('function linear')) {
	throw new Error('graph layout');
}
if (graph.includes('fitView={items.length < 16}')) throw new Error('fit view still clips the first phase');
if (!graph.includes("from '@xyflow/svelte'")) throw new Error('graph library');

const catalog = readFileSync(new URL('../src/lib/catalog/portal/PortalView.svelte', import.meta.url), 'utf8');
const form = readFileSync(new URL('../src/lib/catalog/portal/RecordForm.svelte', import.meta.url), 'utf8');
if (catalog.includes('@xyflow/svelte') || catalog.includes('$lib/flow')) throw new Error('catalog imports flow');
if (form.includes('@xyflow/svelte') || form.includes('$lib/flow')) throw new Error('form imports flow');

const mail = readFileSync(new URL('../src/lib/flow/mail/nodes.ts', import.meta.url), 'utf8');
if (mail.includes("'/mail'") || mail.includes("'/calendar'") || mail.includes("'/files'")) {
	throw new Error('mail graph still points at a shell');
}

console.log('ok');
