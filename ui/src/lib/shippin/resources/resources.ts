import { authorization } from '../../adapter/session';
import type { ResourceReport } from './resources-call';

export * from './resources-call';

export async function loadResources(): Promise<ResourceReport> {
	const auth = authorization();
	if (!auth) throw new Error('Sign in again to continue.');
	const res = await fetch('/api/resources', { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: auth } });
	if (res.status === 403) throw new Error('Only administrators can see this.');
	if (!res.ok) throw new Error('Resources could not be loaded.');
	return (await res.json()) as ResourceReport;
}
