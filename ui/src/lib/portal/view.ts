import { views, type PortalView } from './catalog';

export function findView(id: string): PortalView | undefined {
	if (Object.prototype.hasOwnProperty.call(views, id)) return views[id as keyof typeof views];
}
