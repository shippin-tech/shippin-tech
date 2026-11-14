import { describe, expect, it } from 'vitest';
import {
	BASELINES,
	SASL_TLS_ONLY,
	baselinePatches,
	baselineState,
	describeValue,
	objectsFor,
	pendingChanges,
	sameValue,
	type BaselineRecords
} from '../src/lib/portal/baseline';

const DAY = 86_400_000;

/** Values observed on the local Docker server on 2026-11-09 (singleton get on each x: object). */
const serverDefaults: BaselineRecords = {
	'x:Security': { authBanRate: { count: 100, period: DAY }, authBanPeriod: null, id: 'singleton' },
	'x:Imap': { allowPlainTextAuth: false, maxAuthFailures: 3, id: 'singleton' },
	'x:Http': { enableHsts: false, rateLimitAnonymous: { count: 100, period: 60_000 }, id: 'singleton' },
	'x:SenderAuth': {
		dkimStrict: true,
		dmarcVerify: { match: { '0': { if: 'local_port == 25', then: 'relaxed' } }, else: 'disable' },
		id: 'singleton'
	},
	'x:MtaStageAuth': { saslMechanisms: SASL_TLS_ONLY, id: 'singleton' }
};

const byId = Object.fromEntries(BASELINES.map((b) => [b.id, b]));

describe('security baseline catalogue', () => {
	it('lists the four landing-page rules and names the one this build cannot enforce', () => {
		expect(BASELINES.map((b) => b.id)).toEqual(['mfa', 'transport', 'plaintext', 'brute-force']);
		expect(byId.mfa.unavailable).toMatch(/no account-wide MFA/);
		expect(byId.mfa.settings).toEqual([]);
		for (const baseline of BASELINES.filter((b) => !b.unavailable)) expect(baseline.settings.length).toBeGreaterThan(0);
	});

	it('only touches singleton objects that exist on the server schema', () => {
		expect(objectsFor().sort()).toEqual(['x:Http', 'x:Imap', 'x:MtaStageAuth', 'x:Security', 'x:SenderAuth']);
	});
});

describe('baselineState', () => {
	it('is off on a default server for rules that change something, and on for rules the defaults already satisfy', () => {
		expect(baselineState(byId.transport, serverDefaults)).toBe('off');
		expect(baselineState(byId['brute-force'], serverDefaults)).toBe('off');
		// IMAP plain-text is already refused and SMTP SASL already needs TLS on this build.
		expect(baselineState(byId.plaintext, serverDefaults)).toBe('on');
		expect(baselineState(byId.mfa, serverDefaults)).toBe('unavailable');
	});

	it('reports mixed when only some differing settings match', () => {
		const records: BaselineRecords = {
			...serverDefaults,
			'x:Http': { ...serverDefaults['x:Http'], enableHsts: true }
		};
		expect(baselineState(byId.transport, records)).toBe('mixed');
	});

	it('reports unknown when a record has not loaded', () => {
		const { 'x:Security': _omit, ...partial } = serverDefaults;
		expect(baselineState(byId['brute-force'], partial)).toBe('unknown');
	});

	it('is on once every on-value is written', () => {
		const after: BaselineRecords = { ...serverDefaults };
		for (const [object, patch] of Object.entries(baselinePatches(byId['brute-force'], true))) {
			after[object] = { ...after[object], ...patch };
		}
		expect(baselineState(byId['brute-force'], after)).toBe('on');
		for (const [object, patch] of Object.entries(baselinePatches(byId['brute-force'], false))) {
			after[object] = { ...after[object], ...patch };
		}
		expect(baselineState(byId['brute-force'], after)).toBe('off');
	});
});

describe('baselinePatches', () => {
	it('groups writes per object with only the listed properties', () => {
		expect(baselinePatches(byId.transport, true)).toEqual({
			'x:Http': { enableHsts: true },
			'x:SenderAuth': {
				dkimStrict: true,
				dmarcVerify: { match: { '0': { if: 'local_port == 25', then: 'strict' } }, else: 'disable' }
			}
		});
		expect(baselinePatches(byId['brute-force'], true)['x:Security']).toEqual({
			authBanRate: { count: 10, period: 3_600_000 },
			authBanPeriod: DAY
		});
	});

	it('restores server defaults when turned off', () => {
		const off = baselinePatches(byId['brute-force'], false);
		expect(off['x:Security']).toEqual({ authBanRate: { count: 100, period: DAY }, authBanPeriod: null });
		expect(baselinePatches(byId.transport, false)['x:Http']).toEqual({ enableHsts: false });
	});
});

describe('pendingChanges and descriptions', () => {
	it('names exactly the settings whose server value differs from the target', () => {
		const changes = pendingChanges(byId.transport, serverDefaults, true).map((s) => `${s.object}.${s.property}`);
		expect(changes).toEqual(['x:Http.enableHsts', 'x:SenderAuth.dmarcVerify']);
		expect(pendingChanges(byId.plaintext, serverDefaults, true)).toEqual([]);
	});

	it('describes values in operator words', () => {
		expect(describeValue(true)).toBe('on');
		expect(describeValue(null)).toBe('unset');
		expect(describeValue(DAY)).toBe('1 day');
		expect(describeValue({ count: 10, period: 3_600_000 })).toBe('10 per 1 hour');
		expect(describeValue({ match: { '0': { if: 'local_port == 25', then: 'strict' } }, else: 'disable' })).toBe(
			'if local_port == 25 then strict; else disable'
		);
	});

	it('compares nested JSON structurally', () => {
		expect(sameValue({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(true);
		expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(sameValue(null, undefined)).toBe(true);
		expect(sameValue(0, false)).toBe(false);
	});
});
