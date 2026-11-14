export type SearchKind = 'link' | 'form' | 'field';

export type SearchEntry = {
	text: string;
	type: SearchKind;
	viewName: string;
	section: string;
	breadcrumb: string;
	keywords: readonly string[];
	kind: string;
};

type LayoutLike = {
	name: string;
	items: readonly {
		name: string;
		view: string;
		children: readonly { name: string; view: string }[];
	}[];
};

type ViewLike = {
	kind: string;
	description: string;
	sections: readonly {
		title: string;
		fields: readonly { name: string; label: string }[];
	}[];
};

const order: Record<SearchKind, number> = { link: 0, form: 1, field: 2 };
const limit = 15;

export function searchTitle(text: string): string {
	const parts = text.replace(/^x:/, '').split('/');
	return parts[parts.length - 1] ?? text;
}

export function searchLabel(entry: Pick<SearchEntry, 'type' | 'kind'>): 'Settings' | 'List' | 'Create' {
	if (entry.kind === 'singleton') return 'Settings';
	if (entry.type === 'link') return 'List';
	return 'Create';
}

export function buildSearchIndex<V extends ViewLike>(
	layouts: readonly LayoutLike[],
	views: Readonly<Record<string, V>>
): SearchEntry[] {
	const entries: SearchEntry[] = [];
	const placed = new Map<string, { section: string; name: string }>();

	for (const layout of layouts) {
		for (const item of layout.items) {
			if (item.view) {
				entries.push(page(item.name, item.view, layout.name, `${layout.name} > ${item.name}`, views));
				placed.set(item.view, { section: layout.name, name: item.name });
			}
			for (const child of item.children) {
				const crumb = `${layout.name} > ${item.name} > ${child.name}`;
				entries.push(page(child.name, child.view, layout.name, crumb, views));
				if (!placed.has(child.view)) placed.set(child.view, { section: layout.name, name: child.name });
			}
		}
	}

	for (const [viewName, place] of placed) {
		const record = views[viewName];
		if (!record || record.kind === 'view') continue;
		if (record.description) {
			entries.push({
				text: record.description,
				type: 'link',
				viewName,
				section: place.section,
				breadcrumb: `${place.section} > ${place.name}`,
				keywords: [],
				kind: record.kind
			});
		}
		for (const section of record.sections) {
			if (section.title) {
				entries.push({
					text: section.title,
					type: 'form',
					viewName,
					section: place.section,
					breadcrumb: `${place.section} > ${place.name} > ${section.title}`,
					keywords: [],
					kind: record.kind
				});
			}
			for (const field of section.fields) {
				entries.push({
					text: field.label,
					type: 'field',
					viewName,
					section: place.section,
					breadcrumb: `${place.section} > ${place.name} > ${field.label}`,
					keywords: field.name && field.name !== '@type' ? [field.name] : [],
					kind: record.kind
				});
			}
		}
	}

	return entries;
}

function page<V extends ViewLike>(
	text: string,
	viewName: string,
	section: string,
	breadcrumb: string,
	views: Readonly<Record<string, V>>
): SearchEntry {
	return {
		text,
		type: 'link',
		viewName,
		section,
		breadcrumb,
		keywords: [],
		kind: views[viewName]?.kind ?? 'object'
	};
}

export function querySearch(entries: readonly SearchEntry[], query: string): SearchEntry[] {
	const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
	if (tokens.length === 0) return [];
	const matched = entries.filter((entry) => {
		const haystack = `${entry.text} ${entry.keywords.join(' ')}`.toLowerCase();
		return tokens.every((token) => haystack.includes(token));
	});
	matched.sort((left, right) => order[left.type] - order[right.type]);
	return matched.slice(0, limit);
}

export function groupSearch(entries: readonly SearchEntry[]): { type: SearchKind; heading: string; entries: SearchEntry[] }[] {
	const headings: Record<SearchKind, string> = {
		link: 'Pages',
		form: 'Form Sections',
		field: 'Fields'
	};
	const seen = new Set<string>();
	const buckets: Record<SearchKind, SearchEntry[]> = { link: [], form: [], field: [] };
	for (const entry of entries) {
		const key = [entry.type, entry.section, entry.viewName, entry.breadcrumb, entry.text].join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		buckets[entry.type].push(entry);
	}
	return (['link', 'form', 'field'] as const).flatMap((type) =>
		buckets[type].length ? [{ type, heading: headings[type], entries: buckets[type] }] : []
	);
}
