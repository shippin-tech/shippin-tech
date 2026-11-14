/** The admin panel's own menu. The schema's screens sit under "All settings". */

export type AdminLink = { label: string; href: string };
export type AdminGroup = { name: string; links: AdminLink[] };

export const ADMIN_BASE = '/shippin/admin';

export const ADMIN_MENU: readonly AdminGroup[] = [
	{
		name: 'Overview',
		links: [
			{ label: 'Dashboard', href: ADMIN_BASE },
			{ label: 'Resources', href: `${ADMIN_BASE}/resources` }
		]
	},
	{
		name: 'People',
		links: [
			{ label: 'Organisations', href: `${ADMIN_BASE}/orgs` },
			{ label: 'People and teams', href: `${ADMIN_BASE}/people` }
		]
	},
	{
		name: 'Mail',
		links: [
			{ label: 'Delivery check', href: `${ADMIN_BASE}/delivery` },
			{ label: 'Tracing', href: `${ADMIN_BASE}/tracing` },
			{ label: 'Alerts', href: `${ADMIN_BASE}/alerts` },
			{ label: 'Recover deleted', href: `${ADMIN_BASE}/recover` },
			{ label: 'Calendar emails', href: `${ADMIN_BASE}/templates` }
		]
	},
	{
		name: 'Security',
		links: [
			{ label: 'TLS certificates', href: `${ADMIN_BASE}/tls` },
			{ label: 'Security baseline', href: `${ADMIN_BASE}/security` },
			{ label: 'Keys', href: `${ADMIN_BASE}/keys` }
		]
	},
	{ name: 'AI', links: [{ label: 'AI settings', href: `${ADMIN_BASE}/ai` }] }
];

/** Schema screens that have their own place in the menu above. */
const OWN_VIEWS = new Set(['CustomComponent/Dashboard', 'CustomComponent/LiveTracing', 'CustomComponent/LiveDelivery']);

export function isCurrent(path: string, href: string): boolean {
	return path === href;
}

type Item = { readonly name: string; readonly view: string; readonly children: readonly { readonly name: string; readonly view: string }[] };
type Layout = { readonly name: string; readonly items: readonly Item[] };

/** The schema's menu without the screens we show elsewhere, and without anything left empty. */
export function settingsMenu(layouts: readonly Layout[]): { name: string; items: Item[] }[] {
	return layouts
		.map((layout) => ({
			name: layout.name,
			items: layout.items
				.filter((item) => !OWN_VIEWS.has(item.view))
				.map((item) => ({ ...item, children: item.children.filter((child) => !OWN_VIEWS.has(child.view)) }))
				.filter((item) => item.view !== '' || item.children.length > 0)
		}))
		.filter((layout) => layout.items.length > 0);
}
