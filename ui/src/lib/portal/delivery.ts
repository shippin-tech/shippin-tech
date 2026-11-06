export const DELIVERY_TITLE = 'Delivery Trace';
export const DELIVERY_SUBTITLE =
	'Run a real outbound SMTP delivery attempt and watch every DNS lookup, TLS handshake, and SMTP command as it happens.';
export const TARGET_LABEL = 'Target address or domain';
export const TARGET_PLACEHOLDER = 'john@example.org or example.org';
export const START_TRACE = 'Start trace';
export const INVALID_TARGET = 'Enter a valid email address or domain.';
export const FAILED_START = 'Failed to start trace.';
export const REFUSED = 'The server refused the trace stream.';
export const TIMED_OUT = 'Trace timed out after 120 seconds.';
export const WAITING = 'Waiting for more events';

const PHASES: [string, string][] = [
	['mxLookup', 'MX Lookup'],
	['mtaStsNotFound', 'MTA-STS Policy Fetch'],
	['mtaStsFetch', 'MTA-STS Policy Fetch'],
	['tlsRptNotFound', 'TLS-RPT Lookup'],
	['tlsRptLookup', 'TLS-RPT Lookup'],
	['mtaStsVerify', 'MTA-STS Verify'],
	['tlsaNotFound', 'TLSA / DANE Lookup'],
	['tlsaLookup', 'TLSA / DANE Lookup'],
	['ipLookup', 'IP Lookup'],
	['connection', 'TCP Connection'],
	['readGreeting', 'Read Greeting'],
	['daneVerify', 'DANE Verify']
];

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export type DeliveryStage = { type: string };

export function validTarget(value: string): boolean {
	const target = value.trim();
	if (!target || /\s/.test(target)) return false;
	const at = target.lastIndexOf('@');
	if (at >= 0) {
		const local = target.slice(0, at);
		const domain = target.slice(at + 1);
		return local.length > 0 && !local.includes('@') && DOMAIN.test(domain);
	}
	return DOMAIN.test(target);
}

export function deliveryStreamUrl(token: string, target: string): string {
	if (!token || !validTarget(target)) return '';
	const encoded = encodeURIComponent(target.trim().toLowerCase());
	return `/api/live/delivery/${encoded}?token=${encodeURIComponent(token)}`;
}

export function parseDeliveryFrame(frame: string): DeliveryStage[] {
	const line = frame.split('\n').find((item) => item.startsWith('data: '));
	if (!line) return [];
	const parsed = JSON.parse(line.slice('data: '.length)) as unknown;
	const list = Array.isArray(parsed) ? parsed : [parsed];
	if (!list.every((item) => item && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string')) {
		throw new TypeError('Unexpected delivery event');
	}
	return list.map((item) => ({ type: (item as { type: string }).type }));
}

export function phaseLabel(type: string): string {
	return PHASES.find(([key]) => type.startsWith(key))?.[1] ?? type;
}

export function stageTone(type: string): 'ok' | 'error' | 'warn' | 'pending' {
	if (type === 'completed' || type === 'deliveryAttemptStart') return 'ok';
	if (type.endsWith('Error')) return 'error';
	if (type.endsWith('NotFound')) return 'warn';
	if (type.endsWith('Start')) return 'pending';
	return 'ok';
}
