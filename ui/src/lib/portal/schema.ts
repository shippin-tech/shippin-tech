export type PropertyType = {
	type: string; format?: string; nullable?: boolean; objectName?: string;
	class?: PropertyType; keyClass?: PropertyType; valueClass?: PropertyType; enumName?: string;
};
export type Property = { type: PropertyType; update: string; description?: string; enterprise?: boolean };
export type FormField = { name: string; label: string };
export type ReferenceOption = { id: string; label: string };
export type ReferenceLoader = (name: string) => Promise<ReferenceOption[]>;
export type PortalSchema = {
	objects: Record<string, { type: string; objectName?: string }>;
	lists: Record<string, { filtersStatic?: Record<string, unknown>; labelProperty?: string }>;
	fields: Record<string, { properties: Record<string, Property>; defaults?: Record<string, unknown> }>;
	forms: Record<string, { title?: string; subtitle?: string; sections: { title?: string; fields: FormField[] }[] }>;
	schemas: Record<string, { type: string; schemaName?: string; variants?: { name: string; label: string; schemaName?: string }[] }>;
	enums: Record<string, { name: string; label?: string }[] | Record<string, unknown>>;
};

export function recordSchema(schema: PortalSchema, object: string, value: Record<string, unknown>): string {
	const spec = schema.schemas[object];
	return spec?.type === 'multiple'
		? spec.variants?.find((variant) => variant.name === value['@type'])?.schemaName ?? ''
		: spec?.schemaName ?? object;
}

export function defaultsFor(schema: PortalSchema, name: string): Record<string, unknown> {
	return JSON.parse(JSON.stringify(schema.fields[name]?.defaults ?? {}));
}

export function initialForType(schema: PortalSchema, spec: PropertyType): unknown {
	if (spec.nullable) return null;
	if (spec.type === 'boolean') return false;
	if (spec.type === 'number') return 0;
	if (spec.type === 'set' || spec.type === 'objectList') return {};
	if (spec.type === 'map') return {};
	if (spec.type === 'object') {
		const variant = schema.schemas[spec.objectName ?? '']?.variants?.[0];
		return variant ? { ...defaultsFor(schema, variant.schemaName ?? ''), '@type': variant.name } : defaultsFor(schema, spec.objectName ?? '');
	}
	return '';
}

export function recordPatch(schema: PortalSchema, object: string, original: Record<string, unknown>, draft: Record<string, unknown>, creating: boolean) {
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(draft)) {
		const property = schema.fields[object]?.properties[key];
		if (!property || property.update === 'serverSet' || (!creating && property.update === 'immutable')) continue;
		if (creating || JSON.stringify(value) !== JSON.stringify(original[key])) patch[key] = value;
	}
	return patch;
}
