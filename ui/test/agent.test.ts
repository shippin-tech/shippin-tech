import { describe, expect, it } from 'vitest';
import { allowedRoute, onRoute, parseCall, phaseText, shownArguments } from '../src/lib/shippin/agent/agent-call';

const raw = {
	callId: 'c1',
	name: 'keys.replace',
	title: 'Replace a service key',
	route: '/shippin/admin/keys',
	writes: true,
	destructive: true,
	secret: ['value'],
	arguments: { service: 'ai', value: 'do-not-show', count: 2 },
	seconds: 120
};

describe('the agent bar', () => {
	it('reads only well-formed calls from the server', () => {
		expect(parseCall(JSON.stringify(raw))?.name).toBe('keys.replace');
		expect(parseCall('not json')).toBeNull();
		expect(parseCall(JSON.stringify({ name: 'x' }))).toBeNull();
		const bare = parseCall(JSON.stringify({ callId: 'c', name: 'screen.read', route: '/shippin/admin' }))!;
		expect(bare).toMatchObject({ title: 'screen.read', writes: false, destructive: false, secret: [], arguments: {}, seconds: 120 });
	});

	it('shows every argument, masking the secret ones', () => {
		expect(shownArguments(parseCall(JSON.stringify(raw))!)).toEqual([
			{ name: 'service', value: 'ai' },
			{ name: 'value', value: '••••••••' },
			{ name: 'count', value: '2' }
		]);
	});

	it('says plainly what the agent is doing and asks before it changes anything', () => {
		const call = parseCall(JSON.stringify(raw))!;
		expect(phaseText(call, 'moving')).toBe('An AI agent is opening the screen for: Replace a service key.');
		expect(phaseText(call, 'asking')).toMatch(/replaces or removes something\. Allow it\?$/);
		expect(phaseText({ ...call, destructive: false }, 'asking')).toBe('An AI agent wants to: Replace a service key. Allow it?');
		expect(phaseText(call, 'working')).toBe('An AI agent is doing: Replace a service key.');
	});

	it('opens only pages of the admin panel', () => {
		expect(allowedRoute('/shippin/admin')).toBe(true);
		expect(allowedRoute('/shippin/admin/keys')).toBe(true);
		for (const bad of ['/mail', 'https://evil.example', '/shippin/admin/../mail', '/shippin/admin?x=1', '/shippin/adminx', 3]) {
			expect(allowedRoute(bad)).toBe(false);
		}
		expect(onRoute('/shippin/admin/keys/', '/shippin/admin/keys')).toBe(true);
		expect(onRoute('/shippin/admin', '/shippin/admin/keys')).toBe(false);
	});
});
