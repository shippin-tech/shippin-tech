import { layouts } from '$lib/portal/catalog';
import { layoutGraph as build } from './graph';

export function layoutGraph(name: string) {
	return build(layouts, name);
}
