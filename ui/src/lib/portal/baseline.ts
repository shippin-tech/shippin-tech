/**
 * Security baselines: named bundles of server settings an operator turns on with one checkbox.
 *
 * Each baseline lists exactly which singleton properties it changes and the value it writes when
 * switched on or off. Nothing is switched on for the operator; the portal only reports whether the
 * current server values already match a baseline and applies the listed writes on request.
 *
 * Values mirror the server's JMAP object shapes (durations in milliseconds, expressions as
 * `{ match: { "0": { if, then } }, else }`) so reads and writes compare without translation.
 */

export type Expression = { match: Record<string, { if: string; then: string }>; else: string };
export type Rate = { count: number; period: number };
export type SettingValue = boolean | number | string | null | Rate | Expression;

export type BaselineSetting = {
	/** JMAP singleton object, for example `x:Security`. */
	object: string;
	/** Property on that object. */
	property: string;
	/** Human label for the property. */
	label: string;
	/** Value written when the baseline is turned on. */
	on: SettingValue;
	/** Value written when the baseline is turned off (the server default). */
	off: SettingValue;
	/** One sentence saying what the `on` value does. */
	effect: string;
};

export type Baseline = {
	id: string;
	title: string;
	summary: string;
	settings: BaselineSetting[];
	/** Set when this server build has no setting that implements the baseline. */
	unavailable?: string;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

const PORT25 = 'local_port == 25';

function onPort25(then: string, otherwise = 'disable'): Expression {
	return { match: { '0': { if: PORT25, then } }, else: otherwise };
}

export const SASL_TLS_ONLY: Expression = {
	match: {
		'0': { if: 'local_port != 25 && is_tls', then: '[plain, login, oauthbearer, xoauth2]' },
		'1': { if: 'local_port != 25', then: '[oauthbearer, xoauth2]' }
	},
	else: 'false'
};

export const BASELINES: readonly Baseline[] = [
	{
		id: 'mfa',
		title: 'Require MFA for all accounts',
		summary: 'Every account must enrol a second factor before it can sign in.',
		settings: [],
		unavailable:
			'This server build has no account-wide MFA requirement. Each account can enrol a one-time password under Account → Password, and the server enforces it for that account once enrolled.'
	},
	{
		id: 'transport',
		title: 'Enforce strict transport and DMARC',
		summary: 'Browsers are pinned to HTTPS, DKIM signatures must align exactly, and inbound DMARC is verified strictly on port 25.',
		settings: [
			{
				object: 'x:Http',
				property: 'enableHsts',
				label: 'HTTP Strict Transport Security',
				on: true,
				off: false,
				effect: 'Sends the Strict-Transport-Security header so browsers refuse plain HTTP to this host.'
			},
			{
				object: 'x:SenderAuth',
				property: 'dkimStrict',
				label: 'Strict DKIM canonicalisation',
				on: true,
				off: true,
				effect: 'Signatures must match the exact message bytes; relaxed matching is not accepted.'
			},
			{
				object: 'x:SenderAuth',
				property: 'dmarcVerify',
				label: 'DMARC verification on port 25',
				on: onPort25('strict'),
				off: onPort25('relaxed'),
				effect: 'Inbound mail on port 25 is checked against the sender domain’s DMARC policy in strict alignment mode, so failing mail is treated as the policy says, including reject.'
			}
		]
	},
	{
		id: 'plaintext',
		title: 'Block legacy plaintext auth',
		summary: 'Passwords are only accepted over an encrypted connection, on IMAP and on SMTP submission.',
		settings: [
			{
				object: 'x:Imap',
				property: 'allowPlainTextAuth',
				label: 'IMAP plain-text authentication',
				on: false,
				off: true,
				effect: 'IMAP LOGIN and PLAIN are refused until the client has negotiated TLS.'
			},
			{
				object: 'x:MtaStageAuth',
				property: 'saslMechanisms',
				label: 'SMTP SASL mechanisms',
				on: SASL_TLS_ONLY,
				off: SASL_TLS_ONLY,
				effect: 'Submission ports offer PLAIN and LOGIN only inside TLS; without TLS only token mechanisms are offered; port 25 offers none.'
			}
		]
	},
	{
		id: 'brute-force',
		title: 'Rate-limit and lock out brute-force attempts',
		summary: 'Ten failed logins in an hour ban the source address for a day; IMAP drops a session after three failures.',
		settings: [
			{
				object: 'x:Security',
				property: 'authBanRate',
				label: 'Authentication failure ban rate',
				on: { count: 10, period: HOUR },
				off: { count: 100, period: DAY },
				effect: 'An IP that fails authentication ten times within an hour is banned.'
			},
			{
				object: 'x:Security',
				property: 'authBanPeriod',
				label: 'Authentication ban duration',
				on: DAY,
				off: null,
				effect: 'Banned addresses stay blocked for one day instead of indefinitely.'
			},
			{
				object: 'x:Imap',
				property: 'maxAuthFailures',
				label: 'IMAP failures per session',
				on: 3,
				off: 3,
				effect: 'An IMAP session is closed after three wrong passwords.'
			},
			{
				object: 'x:Http',
				property: 'rateLimitAnonymous',
				label: 'Anonymous HTTP rate limit',
				on: { count: 100, period: MINUTE },
				off: { count: 100, period: MINUTE },
				effect: 'Unauthenticated HTTP clients are limited to 100 requests per minute.'
			}
		]
	}
];

export type BaselineRecords = Record<string, Record<string, unknown> | undefined>;

export function objectsFor(baselines: readonly Baseline[] = BASELINES): string[] {
	const names = new Set<string>();
	for (const baseline of baselines) for (const setting of baseline.settings) names.add(setting.object);
	return [...names];
}

/** Deep equality for the small JSON shapes the settings use. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return a == b;
	if (typeof a !== 'object' || typeof b !== 'object') return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) if (!sameValue(left[key], right[key])) return false;
	return true;
}

export type BaselineState = 'on' | 'off' | 'mixed' | 'unavailable' | 'unknown';

/** `on` when every setting already holds its on-value, `off` when none that differ do, `mixed` otherwise. */
export function baselineState(baseline: Baseline, records: BaselineRecords): BaselineState {
	if (baseline.unavailable) return 'unavailable';
	let matched = 0;
	let differing = 0;
	for (const setting of baseline.settings) {
		const record = records[setting.object];
		if (!record) return 'unknown';
		const current = record[setting.property];
		if (sameValue(setting.on, setting.off)) continue;
		differing++;
		if (sameValue(current, setting.on)) matched++;
	}
	if (differing === 0) return 'on';
	if (matched === differing) return 'on';
	if (matched === 0) return 'off';
	return 'mixed';
}

/** Per-object patches to apply when the baseline is switched on or off. */
export function baselinePatches(baseline: Baseline, on: boolean): Record<string, Record<string, SettingValue>> {
	const patches: Record<string, Record<string, SettingValue>> = {};
	for (const setting of baseline.settings) {
		(patches[setting.object] ??= {})[setting.property] = on ? setting.on : setting.off;
	}
	return patches;
}

/** Settings whose current server value differs from the baseline's on-value, for the "what changes" list. */
export function pendingChanges(baseline: Baseline, records: BaselineRecords, on: boolean): BaselineSetting[] {
	return baseline.settings.filter((setting) => {
		const record = records[setting.object];
		const target = on ? setting.on : setting.off;
		return !record || !sameValue(record[setting.property], target);
	});
}

export function describeValue(value: SettingValue): string {
	if (value === null) return 'unset';
	if (typeof value === 'boolean') return value ? 'on' : 'off';
	if (typeof value === 'number') return describeDuration(value);
	if (typeof value === 'string') return value;
	if ('count' in value && 'period' in value) return `${value.count} per ${describeDuration(value.period)}`;
	const rules = Object.values(value.match).map((rule) => `if ${rule.if} then ${rule.then}`);
	return [...rules, `else ${value.else}`].join('; ');
}

export function describeDuration(value: number): string {
	if (value % DAY === 0) return value / DAY === 1 ? '1 day' : `${value / DAY} days`;
	if (value % HOUR === 0) return value / HOUR === 1 ? '1 hour' : `${value / HOUR} hours`;
	if (value % MINUTE === 0) return value / MINUTE === 1 ? '1 minute' : `${value / MINUTE} minutes`;
	if (value % 1000 === 0) return `${value / 1000} s`;
	return String(value);
}
