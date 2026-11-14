/** Pure helpers for the self-service mail panel. No transport here. */

export type PanelPlan = {
	signup: 'open' | 'closed';
	dnsProof: boolean;
	mailboxes: number;
	aliases: number;
	mailboxMb: number;
	sendsPerDay: number;
	mailHost: string;
	verifyLabel: string;
};

export type VerifyRecord = { type: 'TXT'; name: string; value: string };

export type DomainView = {
	domain: string;
	plan: { mailboxes: number; aliases: number; mailboxMb: number };
	usage: { mailboxes: number; aliases: number };
	catchAll: string | null;
	mailHost: string;
	dnsZone: string;
};

export type Mailbox = {
	id: string;
	name: string;
	email: string;
	owner: boolean;
	you: boolean;
	aliases: string[];
	quotaBytes: number;
	usedBytes: number;
};

export type DnsRow = {
	type: string;
	/** Fully qualified name without the trailing dot. */
	name: string;
	/** What most DNS providers want in the "host" field: "@" for the domain itself. */
	host: string;
	value: string;
	purpose: string;
	required: boolean;
};

function unquote(text: string): string {
	const parts = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(["\\])/g, '$1'));
	return parts.length > 0 ? parts.join('') : text.trim();
}

function hostFor(name: string, domain: string): string {
	if (name === domain) return '@';
	const suffix = `.${domain}`;
	return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

function purposeOf(type: string, name: string, value: string, domain: string): { purpose: string; required: boolean } {
	if (type === 'MX') return { purpose: 'Receive mail', required: true };
	if (type === 'TXT' && value.startsWith('v=spf1')) return { purpose: 'SPF: who may send for the domain', required: true };
	if (type === 'TXT' && name.includes('._domainkey.')) return { purpose: 'DKIM: signature key', required: true };
	if (type === 'TXT' && name === `_dmarc.${domain}`) return { purpose: 'DMARC: policy for failed checks', required: true };
	if (type === 'TXT' && name.startsWith('_mta-sts.')) return { purpose: 'MTA-STS: require TLS', required: false };
	if (type === 'TXT' && name.startsWith('_smtp._tls.')) return { purpose: 'TLS reports', required: false };
	if (type === 'SRV') return { purpose: 'Mail app auto-setup', required: false };
	if (type === 'CNAME' && /^(autoconfig|autodiscover)\./.test(name)) return { purpose: 'Mail app auto-setup', required: false };
	if (type === 'CNAME' && name.startsWith('mta-sts.')) return { purpose: 'MTA-STS policy host', required: false };
	if (type === 'TLSA') return { purpose: 'DANE: pin the TLS certificate', required: false };
	if (type === 'CAA') return { purpose: 'Certificate authority policy', required: false };
	return { purpose: '', required: false };
}

/** Parses the server's BIND-style zone text into rows, required records first. */
export function parseZone(zone: string, domain: string): DnsRow[] {
	const rows: DnsRow[] = [];
	const lines = zone.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim();
		const match = /^(\S+)\s+IN\s+([A-Z]+)\s+(.*)$/.exec(line);
		if (!match) continue;
		const [, rawName, type, rest] = match;
		let value = rest.trim();
		if (value === '(') {
			const chunks: string[] = [];
			for (index += 1; index < lines.length && lines[index].trim() !== ')'; index += 1) chunks.push(lines[index]);
			value = unquote(chunks.join(' '));
		} else if (type === 'TXT') {
			value = unquote(value);
		}
		const name = rawName.replace(/\.$/, '');
		const shown = type === 'TXT' ? value : value.replace(/\.$/, '');
		rows.push({ type, name, host: hostFor(name, domain), value: shown, ...purposeOf(type, name, value, domain) });
	}
	return rows.sort((a, b) => Number(b.required) - Number(a.required));
}

export type DnsCheck = {
	kind: 'MX' | 'SPF' | 'DKIM' | 'DMARC';
	name: string;
	expected: string;
	state: 'found' | 'different' | 'missing';
	actual: string | null;
};

/** The live check that belongs to a zone row, if the row is one the server checks. */
export function checkFor(row: DnsRow, checks: DnsCheck[]): DnsCheck | undefined {
	const kind =
		row.type === 'MX'
			? 'MX'
			: row.type !== 'TXT'
				? null
				: row.value.startsWith('v=spf1')
					? 'SPF'
					: row.name.includes('._domainkey.')
						? 'DKIM'
						: row.name.startsWith('_dmarc.')
							? 'DMARC'
							: null;
	if (!kind) return undefined;
	return checks.find((check) => check.kind === kind && check.name.replace(/\.$/, '') === row.name);
}

export function stateLabel(check: DnsCheck | undefined): string {
	if (!check) return 'Not checked';
	if (check.state === 'found') return 'Published';
	if (check.state === 'different') return 'Different value';
	return 'Missing';
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
	const mb = bytes / (1024 * 1024);
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	const gb = mb / 1024;
	return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

export function remaining(limit: number, used: number): number {
	return Math.max(0, limit - used);
}

/** Mirrors the server's local-part rule so the form can say no before a round trip. */
export function validLocalPart(input: string): boolean {
	const local = input.trim().toLowerCase();
	return (
		local.length > 0 &&
		local.length <= 64 &&
		!local.startsWith('.') &&
		!local.endsWith('.') &&
		!local.includes('..') &&
		/^[a-z0-9._-]+$/.test(local)
	);
}

export function validDomain(input: string): boolean {
	const domain = input.trim().replace(/\.$/, '').toLowerCase();
	return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(domain);
}

export function passwordProblem(password: string): string {
	if ([...password].length < 10) return 'Use at least 10 characters.';
	if (password.startsWith('$') || password.startsWith('{')) return 'Passwords cannot start with $ or {.';
	return '';
}

/** Connection settings every mail app asks for. Hostnames come from the server. */
export function connectionSettings(mailHost: string): { label: string; value: string }[] {
	return [
		{ label: 'IMAP (incoming)', value: `${mailHost}, port 993, SSL/TLS` },
		{ label: 'SMTP (outgoing)', value: `${mailHost}, port 465 SSL/TLS, or 587 STARTTLS` },
		{ label: 'User name', value: 'Your full email address' }
	];
}
