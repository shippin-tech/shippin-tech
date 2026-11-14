/**
 * Reads the portal schema and writes the typed catalog the Svelte app renders.
 * Run: node --experimental-strip-types scripts/emit-portal.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, '../resources/schema/schema.json.gz');
const outPath = resolve(root, 'src/lib/portal/catalog.ts');

type Field = { name?: string; label?: string };
type PropertyType = { type?: string; format?: string; objectName?: string };
type Property = { type?: PropertyType; update?: string; enterprise?: boolean };
type FieldCatalog = { properties?: Record<string, Property> };
type Variant = { name?: string; label?: string; schemaName?: string };
type SchemaRecord = { variants?: Variant[] };
type Section = { title?: string; fields?: Field[] };
type Form = { sections?: Section[] };
type Column = { name?: string; label?: string };
type List = { title?: string; subtitle?: string; columns?: Column[] };
type ObjectRecord = { type?: string; description?: string; objectName?: string };
type Link = {
	name?: string;
	viewName?: string;
	type?: string;
	link?: Link;
	container?: { name?: string; items?: Link[] };
};
type Layout = { name?: string; items?: Link[] };
type Card = {
	title?: string;
	icon?: string;
	source?: string;
	metrics?: string[];
	aggregate?: string;
	format?: string;
	description?: string;
	sparkline?: boolean;
	delta?: boolean;
};
type ChartSeries = { label?: string; metrics?: string[]; aggregate?: string };
type Chart = {
	title?: string;
	kind?: string;
	series?: ChartSeries[];
	stacked?: boolean;
	valueFormat?: string;
	description?: string;
};
type Dashboard = { id?: string; label?: string; cards?: Card[]; charts?: Chart[] };
type Schema = {
	objects: Record<string, ObjectRecord>;
	forms: Record<string, Form>;
	fields: Record<string, FieldCatalog>;
	lists: Record<string, List>;
	layouts: Layout[];
	dashboards: Dashboard[];
	schemas?: Record<string, SchemaRecord>;
};


function named(items: Field[] | undefined): { name: string; label: string }[] {
	return (items ?? []).flatMap((item) =>
		item.name && item.label ? [{ name: item.name, label: item.label }] : []
	);
}

function typedFields(
	items: Field[] | undefined,
	catalog: FieldCatalog | undefined
): { name: string; label: string; type: string; format: string }[] {
	return (items ?? []).flatMap((item) => {
		if (!item.name || !item.label) return [];
		const spec = catalog?.properties?.[item.name]?.type;
		return [{ name: item.name, label: item.label, type: spec?.type ?? '', format: spec?.format ?? '' }];
	});
}

function sectionsOf(
	form: Form | undefined,
	catalog: FieldCatalog | undefined
): { title: string; fields: { name: string; label: string; type: string; format: string }[] }[] {
	return (form?.sections ?? []).flatMap((section) => {
		const fields = typedFields(section.fields, catalog);
		return fields.length ? [{ title: section.title ?? '', fields }] : [];
	});
}

type BootstrapField = {
	name: string;
	label: string;
	kind: 'text' | 'boolean' | 'choice';
	options: { value: string; label: string }[];
};

function bootstrapSteps(schema: Schema): { title: string; fields: BootstrapField[] }[] {
	const form = schema.forms['x:Bootstrap'];
	const properties = schema.fields['x:Bootstrap']?.properties ?? {};
	return (form?.sections ?? []).flatMap((section) => {
		const fields = (section.fields ?? []).flatMap((field): BootstrapField[] => {
			if (!field.name || !field.label) return [];
			const property = properties[field.name];
			if (!property || property.update === 'serverSet' || property.enterprise) return [];
			const spec = property.type;
			if (spec?.type === 'boolean') {
				return [{ name: field.name, label: field.label, kind: 'boolean', options: [] }];
			}
			if (spec?.type === 'object' && spec.objectName) {
				const options = (schema.schemas?.[spec.objectName]?.variants ?? []).flatMap((variant) =>
					variant.name && variant.label ? [{ value: variant.name, label: brand(variant.label) }] : []
				);
				return [{ name: field.name, label: field.label, kind: 'choice', options }];
			}
			return [{ name: field.name, label: field.label, kind: 'text', options: [] }];
		});
		return fields.length ? [{ title: section.title ?? '', fields }] : [];
	});
}

function walk(items: Link[] | undefined, into: { name: string; view: string; children: { name: string; view: string }[] }[]) {
	for (const raw of items ?? []) {
		const link = raw.link ?? (raw.name ? raw : undefined);
		if (link?.name && link.viewName) into.push({ name: link.name, view: link.viewName, children: [] });
		const container = raw.container;
		if (!container?.name) continue;
		const children = (container.items ?? []).flatMap((child) =>
			child.name && child.viewName ? [{ name: child.name, view: child.viewName }] : []
		);
		if (children.length) into.push({ name: container.name, view: '', children });
	}
}

const schema = JSON.parse(gunzipSync(readFileSync(schemaPath)).toString()) as Schema;
// Screens our own pages replace: Alerts, Recover deleted, webmail's Masked addresses and Organisations.
const REPLACED_VIEWS = new Set(['x:Alert', 'x:ArchivedItem', 'x:MaskedEmail', 'x:Tenant']);

const layouts = (schema.layouts ?? []).map((layout) => {
	const items: { name: string; view: string; children: { name: string; view: string }[] }[] = [];
	walk(layout.items, items);
	return {
		name: layout.name ?? '',
		items: items
			.filter((item) => !REPLACED_VIEWS.has(item.view))
			.map((item) => ({ ...item, children: item.children.filter((child) => !REPLACED_VIEWS.has(child.view)) }))
	};
});

const seen = new Set<string>();
for (const layout of layouts) {
	for (const item of layout.items) {
		if (item.view) seen.add(item.view);
		for (const child of item.children) seen.add(child.view);
	}
}

const views: Record<string, {
	view: string;
	object: string;
	kind: string;
	description: string;
	listTitle: string;
	listSubtitle: string;
	columns: { name: string; label: string }[];
	sections: { title: string; fields: { name: string; label: string; type: string; format: string }[] }[];
}> = {};

for (const view of seen) {
	const record = schema.objects[view];
	const objectName = record?.type === 'view' ? record.objectName ?? view : view;
	const object = schema.objects[objectName] ?? record;
	const list = schema.lists[view] ?? schema.lists[objectName];
	const form = schema.forms[view] ?? schema.forms[objectName];
	const fieldCatalog = schema.fields[objectName] ?? schema.fields[view];
	views[view] = {
		view,
		object: objectName,
		kind: record?.type ?? (view.startsWith('CustomComponent/') ? 'custom' : 'object'),
		description: brand(object?.description ?? ''),
		listTitle: brand(list?.title ?? ''),
		listSubtitle: brand(list?.subtitle ?? ''),
		columns: named(list?.columns),
		sections: sectionsOf(form, fieldCatalog)
	};
}

const bootstrap = {
	description: brand(schema.objects['x:Bootstrap']?.description ?? ''),
	steps: bootstrapSteps(schema)
};

function valueFormat(format: string | undefined): 'number' | 'bytes' | 'duration' {
	return format === 'bytes' || format === 'duration' ? format : 'number';
}

function aggregate(value: string | undefined): 'sum' | 'avg' {
	return value === 'avg' ? 'avg' : 'sum';
}

function metricList(metrics: string[] | undefined): string[] {
	return (metrics ?? []).filter((metric) => typeof metric === 'string' && metric.length > 0);
}

// Every dashboard tab, card and chart the schema defines, rendered by
// ui/src/lib/shippin/dashboard from our own /api/stats.
const dashboards = (schema.dashboards ?? []).flatMap((board) =>
	board.id && board.label
		? [
				{
					id: board.id,
					label: brand(board.label),
					cards: (board.cards ?? []).flatMap((card) =>
						card.title && metricList(card.metrics).length
							? [
									{
										title: brand(card.title),
										icon: card.icon ?? '',
										source: card.source === 'live' ? 'live' : 'history',
										metrics: metricList(card.metrics),
										aggregate: aggregate(card.aggregate),
										format: valueFormat(card.format),
										description: brand(card.description ?? ''),
										sparkline: card.sparkline === true,
										delta: card.delta === true
									}
								]
							: []
					),
					charts: (board.charts ?? []).flatMap((chart) => {
						const series = (chart.series ?? []).flatMap((item) =>
							item.label && metricList(item.metrics).length
								? [{ label: item.label, metrics: metricList(item.metrics), aggregate: aggregate(item.aggregate) }]
								: []
						);
						return chart.title && series.length
							? [
									{
										title: brand(chart.title),
										kind: chart.kind === 'line' || chart.kind === 'area' ? chart.kind : 'bar',
										stacked: chart.stacked === true,
										format: valueFormat(chart.valueFormat),
										description: brand(chart.description ?? ''),
										series
									}
								]
							: [];
					})
				}
			]
		: []
);

const actions = (schema.schemas?.['x:Action']?.variants ?? []).flatMap((variant) =>
	variant.name && variant.label
		? [{ name: variant.name, label: brand(variant.label), schema: variant.schemaName ?? '' }]
		: []
);

const source = `/* Generated by ui/scripts/emit-portal.ts from resources/schema/schema.json.gz. Do not edit. */
export const layouts = ${JSON.stringify(layouts, null, '\t')} as const;

export const views = ${JSON.stringify(views, null, '\t')} as const;

export const dashboards = ${JSON.stringify(dashboards, null, '\t')} as const;

export const bootstrap = ${JSON.stringify(bootstrap, null, '\t')} as const;

export const actions = ${JSON.stringify(actions, null, '\t')} as const;

export type PortalLayout = (typeof layouts)[number];
export type PortalView = (typeof views)[keyof typeof views];
export type BootstrapStep = (typeof bootstrap.steps)[number];
export type PortalAction = (typeof actions)[number];
export type PortalDashboard = (typeof dashboards)[number];
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, source);
console.log(`portal catalog: ${layouts.length} layouts, ${Object.keys(views).length} views, ${dashboards.length} dashboard tabs, ${bootstrap.steps.length} bootstrap steps, ${actions.length} actions`);
