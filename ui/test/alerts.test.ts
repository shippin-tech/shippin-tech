import { describe, expect, it } from 'vitest';
import {
	alertAddresses,
	alertCheckSummary,
	alertCondition,
	alertDestinations,
	alertPayload,
	alertProblem,
	alertStatus,
	draftFromAlert,
	emptyAlertDraft,
	type AlertDraft,
	type AlertRule
} from '../src/lib/shippin/alerts/alerts-call';

const metrics = [{ name: 'auth.failed', description: 'Failed sign-ins' }];

function draft(overrides: Partial<AlertDraft> = {}): AlertDraft {
	return { ...emptyAlertDraft(), name: 'Sign-ins', metric: 'auth.failed', threshold: '10', email: 'ops@example.org', ...overrides };
}

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
	return { id: 'a', name: 'Sign-ins', metric: 'auth.failed', window: '1h', above: true, threshold: 10, email: ['ops@example.org'], webhook: null, enabled: true, cooldownMinutes: 60, lastFired: null, lastValue: null, ...overrides };
}

describe('alert helpers', () => {
	it('explains what is wrong with a draft', () => {
		expect(alertProblem(draft(), metrics)).toBe('');
		expect(alertProblem(draft({ name: ' ' }), metrics)).toMatch(/name/);
		expect(alertProblem(draft({ metric: 'nope' }), metrics)).toMatch(/metric/);
		expect(alertProblem(draft({ threshold: '' }), metrics)).toMatch(/threshold/);
		expect(alertProblem(draft({ threshold: '-1' }), metrics)).toMatch(/threshold/);
		expect(alertProblem(draft({ cooldownMinutes: '0' }), metrics)).toMatch(/Wait/);
		expect(alertProblem(draft({ cooldownMinutes: '1.5' }), metrics)).toMatch(/Wait/);
		expect(alertProblem(draft({ email: '' }), metrics)).toMatch(/email address or a webhook/);
		expect(alertProblem(draft({ email: '', webhook: 'https://x.test/h' }), metrics)).toBe('');
	});

	it('splits addresses however they were typed', () => {
		expect(alertAddresses(' a@b.co, c@d.co;e@f.co\ng@h.co ')).toEqual(['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co']);
		expect(alertAddresses(' , ')).toEqual([]);
	});

	it('turns a draft into what the server expects and back', () => {
		const payload = alertPayload(draft({ name: ' Sign-ins ', webhook: ' ', email: 'a@b.co, c@d.co' }));
		expect(payload).toMatchObject({ name: 'Sign-ins', threshold: 10, webhook: null, email: ['a@b.co', 'c@d.co'], cooldownMinutes: 60 });
		expect(draftFromAlert(rule({ email: ['a@b.co', 'c@d.co'], threshold: 2.5 }))).toMatchObject({ email: 'a@b.co, c@d.co', threshold: '2.5', webhook: '' });
	});

	it('says a rule in words', () => {
		expect(alertCondition(rule())).toBe('auth.failed above 10 over the last hour');
		expect(alertCondition(rule({ above: false, window: '24h', threshold: 0 }))).toBe('auth.failed below 0 over the last day');
		expect(alertDestinations(rule({ webhook: 'https://x.test' }))).toBe('ops@example.org, webhook');
	});

	it('says the latest reading with a space before what follows', () => {
		expect(alertStatus(rule())).toBe('Not sent yet');
		expect(alertStatus(rule({ lastValue: 2 }))).toBe('Latest value 2. Not sent yet');
		expect(alertStatus(rule({ lastValue: 2, lastFired: 1 }))).toMatch(/^Latest value 2\. Last sent /);
	});

	it('sums up a check', () => {
		expect(alertCheckSummary([])).toMatch(/no alerts/);
		expect(alertCheckSummary([{ id: 'a', value: 1, fired: true }])).toBe('Checked 1 alert, 1 sent.');
		expect(alertCheckSummary([{ id: 'a', value: 1, fired: false }, { id: 'b', value: null, fired: false }])).toBe('Checked 2 alerts, 0 sent.');
	});
});
