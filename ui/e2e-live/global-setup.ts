import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The live suite makes hundreds of sign-ins and refused deliveries from one address, which
// the server's own protections rightly treat as abuse. On the local stack only, that
// address is marked as trusted and any ban from an earlier run is lifted. Product
// defaults are not touched, and this never runs against anything but this machine.
const LOCAL_NETWORK = '172.29.0.0/16';

export default async function globalSetup() {
	const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
	if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)) return;

	const admin = JSON.parse(readFileSync(resolve(process.cwd(), '../deploy/local/.credentials.json'), 'utf8')) as {
		username: string;
		secret: string;
	};
	const auth = 'Basic ' + Buffer.from(`${admin.username}:${admin.secret}`).toString('base64');

	async function call(calls: unknown[]) {
		const res = await fetch(`${base}/jmap`, {
			method: 'POST',
			headers: { Authorization: auth, 'Content-Type': 'application/json' },
			body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:shippin.tech:jmap'], methodCalls: calls })
		});
		if (!res.ok) throw new Error(`The local stack answered ${res.status}. Is it running?`);
		return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
	}

	const allowed = await call([
		['x:AllowedIp/query', {}, 'q'],
		['x:AllowedIp/get', { '#ids': { resultOf: 'q', name: 'x:AllowedIp/query', path: '/ids' } }, 'g']
	]);
	const present = ((allowed[1][1].list as { address: string }[] | undefined) ?? []).some((item) => item.address === LOCAL_NETWORK);
	if (!present) {
		const made = await call([['x:AllowedIp/set', { create: { a: { address: LOCAL_NETWORK, reason: 'Local test stack' } } }, 's']]);
		if (!(made[0][1].created as Record<string, unknown> | undefined)?.a) {
			throw new Error(`Could not trust the local test network: ${JSON.stringify(made[0][1].notCreated)}`);
		}
	}

	const blocked = await call([
		['x:BlockedIp/query', {}, 'q'],
		['x:BlockedIp/get', { '#ids': { resultOf: 'q', name: 'x:BlockedIp/query', path: '/ids' } }, 'g']
	]);
	const stale = ((blocked[1][1].list as { id: string; address: string }[] | undefined) ?? []).filter((item) => item.address.startsWith('172.29.')).map((item) => item.id);
	if (stale.length) await call([['x:BlockedIp/set', { destroy: stale }, 'd']]);

	// The server keeps both lists in memory: have it read them again.
	const reloaded = await call([['x:Action/set', { create: { r: { '@type': 'ReloadBlockedIps' } } }, 'r']]);
	if (!(reloaded[0][1].created as Record<string, unknown> | undefined)?.r) {
		throw new Error(`Could not reload the address lists: ${JSON.stringify(reloaded[0][1].notCreated)}`);
	}
}
