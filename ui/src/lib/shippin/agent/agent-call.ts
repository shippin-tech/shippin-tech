/** Pure helpers for the agent bar (MCPL drive); the live parts are in agent.svelte.ts. */

/** One tool call an agent made, as the server hands it to this screen. */
export type AgentCall = {
	callId: string;
	name: string;
	title: string;
	route: string;
	writes: boolean;
	destructive: boolean;
	secret: string[];
	arguments: Record<string, unknown>;
	seconds: number;
};

export type AgentOutcome = { ok: boolean; text: string; data?: unknown };

export const ADMIN_ROOT = '/shippin/admin';

/** Reads a call from the server's event, refusing anything malformed. */
export function parseCall(data: string): AgentCall | null {
	try {
		const raw = JSON.parse(data) as Partial<AgentCall>;
		if (typeof raw.callId !== 'string' || typeof raw.name !== 'string' || typeof raw.route !== 'string') return null;
		return {
			callId: raw.callId,
			name: raw.name,
			title: typeof raw.title === 'string' ? raw.title : raw.name,
			route: raw.route,
			writes: raw.writes === true,
			destructive: raw.destructive === true,
			secret: Array.isArray(raw.secret) ? raw.secret.filter((item): item is string => typeof item === 'string') : [],
			arguments: raw.arguments && typeof raw.arguments === 'object' ? (raw.arguments as Record<string, unknown>) : {},
			seconds: typeof raw.seconds === 'number' ? raw.seconds : 120
		};
	} catch {
		return null;
	}
}

/** The arguments as the operator sees them: secret ones masked, nothing hidden otherwise. */
export function shownArguments(call: AgentCall): { name: string; value: string }[] {
	return Object.entries(call.arguments).map(([name, value]) => ({
		name,
		value: call.secret.includes(name) ? '••••••••' : typeof value === 'string' ? value : JSON.stringify(value)
	}));
}

/** What the bar says while a call runs. */
export function phaseText(call: AgentCall, phase: 'moving' | 'asking' | 'working'): string {
	if (phase === 'moving') return `An AI agent is opening the screen for: ${call.title}.`;
	if (phase === 'asking') {
		return call.destructive
			? `An AI agent wants to: ${call.title}. This replaces or removes something. Allow it?`
			: `An AI agent wants to: ${call.title}. Allow it?`;
	}
	return `An AI agent is doing: ${call.title}.`;
}

/** Only the admin panel's own pages, never anywhere else. */
export function allowedRoute(route: unknown): route is string {
	return typeof route === 'string' && (route === ADMIN_ROOT || route.startsWith(`${ADMIN_ROOT}/`)) && !route.includes('..') && !/[?#\s]/.test(route);
}

/** Whether the screen is already where a call wants it. */
export function onRoute(path: string, route: string): boolean {
	return path.replace(/\/+$/, '') === route.replace(/\/+$/, '');
}
