import { loadPortalSchema, loadRegistryPage } from './portal';
import type { PortalSchema } from '$lib/portal/schema';

export type TlsReport = {
	schema: PortalSchema;
	providers: Record<string, unknown>[];
	domains: Record<string, unknown>[];
	certificates: Record<string, unknown>[];
};

async function records(object: string, properties: string[]): Promise<Record<string, unknown>[]> {
	const items: Record<string, unknown>[] = [];
	let position = 0;
	for (;;) {
		const page = await loadRegistryPage(object, { limit: 200, position, properties });
		items.push(...page.items);
		if (!page.hasNext) return items;
		if (!page.items.length) throw new Error(`The server returned an empty page while listing ${object}.`);
		position += page.items.length;
	}
}

export async function loadTls(): Promise<TlsReport> {
	const schema = await loadPortalSchema();
	for (const name of ['x:AcmeProvider', 'x:Domain', 'x:Certificate']) {
		if (!schema.objects[name]) throw new Error(`TLS management is unavailable: the server schema does not define ${name}.`);
	}
	const [providers, domains, certificates] = await Promise.all([
		records('x:AcmeProvider', ['id', 'description', 'directory', 'challengeType']),
		records('x:Domain', ['id', 'name', 'certificateManagement']),
		records('x:Certificate', ['id', 'issuer', 'subjectAlternativeNames', 'notValidBefore', 'notValidAfter'])
	]);
	return { schema, providers, domains, certificates };
}
