/** Pure helpers for alerts; the calls are in shippin/alerts/alerts.ts. */

export type AlertWindow = '1h' | '24h';

export type AlertRule = {
	id: string;
	name: string;
	metric: string;
	window: AlertWindow;
	above: boolean;
	threshold: number;
	email: string[];
	webhook: string | null;
	enabled: boolean;
	cooldownMinutes: number;
	lastFired: number | null;
	lastValue: number | null;
};

export type AlertMetric = { name: string; description: string };

export type AlertCheck = { id: string; value: number | null; fired: boolean };

export type AlertDraft = {
	id: string;
	name: string;
	metric: string;
	window: AlertWindow;
	above: boolean;
	threshold: string;
	email: string;
	webhook: string;
	enabled: boolean;
	cooldownMinutes: string;
};

export type AlertPayload = Pick<AlertRule, 'id' | 'name' | 'metric' | 'window' | 'above' | 'threshold' | 'email' | 'enabled' | 'cooldownMinutes'> & { webhook: string | null };

export function emptyAlertDraft(): AlertDraft {
	return { id: '', name: '', metric: '', window: '1h', above: true, threshold: '', email: '', webhook: '', enabled: true, cooldownMinutes: '60' };
}

export function draftFromAlert(rule: AlertRule): AlertDraft {
	return {
		id: rule.id,
		name: rule.name,
		metric: rule.metric,
		window: rule.window,
		above: rule.above,
		threshold: String(rule.threshold),
		email: rule.email.join(', '),
		webhook: rule.webhook ?? '',
		enabled: rule.enabled,
		cooldownMinutes: String(rule.cooldownMinutes)
	};
}

export function alertAddresses(text: string): string[] {
	return text
		.split(/[\s,;]+/)
		.map((address) => address.trim())
		.filter(Boolean);
}

/** What is wrong with a draft, before asking the server. The server checks again. */
export function alertProblem(draft: AlertDraft, metrics: readonly AlertMetric[]): string {
	if (!draft.name.trim()) return 'Give the alert a name.';
	if (!metrics.some((metric) => metric.name === draft.metric)) return 'Choose a metric from the list.';
	const threshold = Number(draft.threshold);
	if (draft.threshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0) return 'The threshold must be zero or more.';
	const cooldown = Number(draft.cooldownMinutes);
	if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 10080) return 'Wait between 1 minute and 7 days before alerting again.';
	if (alertAddresses(draft.email).length === 0 && !draft.webhook.trim()) return 'Add an email address or a webhook to send the alert to.';
	return '';
}

export function alertPayload(draft: AlertDraft): AlertPayload {
	return {
		id: draft.id,
		name: draft.name.trim(),
		metric: draft.metric,
		window: draft.window,
		above: draft.above,
		threshold: Number(draft.threshold),
		email: alertAddresses(draft.email),
		webhook: draft.webhook.trim() || null,
		enabled: draft.enabled,
		cooldownMinutes: Number(draft.cooldownMinutes)
	};
}

/** The rule in one sentence. */
export function alertCondition(rule: Pick<AlertRule, 'metric' | 'window' | 'above' | 'threshold'>): string {
	const side = rule.above ? 'above' : 'below';
	const span = rule.window === '24h' ? 'the last day' : 'the last hour';
	return `${rule.metric} ${side} ${rule.threshold} over ${span}`;
}

export function alertDestinations(rule: Pick<AlertRule, 'email' | 'webhook'>): string {
	const parts = [...rule.email];
	if (rule.webhook) parts.push('webhook');
	return parts.join(', ');
}

export function alertLastSent(lastFired: number | null): string {
	return lastFired === null ? 'Not sent yet' : `Last sent ${new Date(lastFired * 1000).toLocaleString()}`;
}

/** The latest reading, if there is one, and when the alert last went out. */
export function alertStatus(rule: Pick<AlertRule, 'lastValue' | 'lastFired'>): string {
	const sent = alertLastSent(rule.lastFired);
	return rule.lastValue === null ? sent : `Latest value ${rule.lastValue}. ${sent}`;
}

export function alertCheckSummary(results: readonly AlertCheck[]): string {
	if (results.length === 0) return 'There are no alerts turned on to check.';
	const fired = results.filter((result) => result.fired).length;
	const checked = results.length === 1 ? 'Checked 1 alert' : `Checked ${results.length} alerts`;
	return `${checked}, ${fired === 1 ? '1 sent.' : `${fired} sent.`}`;
}
