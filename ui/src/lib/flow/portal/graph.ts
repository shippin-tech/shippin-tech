export type PortalNode = {
	id: string;
	href: string;
	label: string;
	parent?: string;
};

type Child = { name: string; view: string };
type Layout = {
	name: string;
	items: readonly { name: string; view: string; children: readonly Child[] }[];
};

export function layoutGraph(layouts: readonly Layout[], name: string): PortalNode[] {
	const layout = layouts.find((item) => item.name === name);
	if (!layout) return [];
	const items: PortalNode[] = [{ id: name, label: name, href: '/shippin/admin' }];
	for (const item of layout.items) {
		if (item.view) {
			items.push({
				id: `${name}:${item.view}`,
				label: item.name,
				href: `/shippin/admin/${item.view}`,
				parent: name
			});
			continue;
		}
		const section = `${name}:${item.name}`;
		items.push({ id: section, label: item.name, href: '/shippin/admin', parent: name });
		for (const child of item.children) {
			items.push({
				id: `${name}:${child.view}`,
				label: child.name,
				href: `/shippin/admin/${child.view}`,
				parent: section
			});
		}
	}
	return items;
}
