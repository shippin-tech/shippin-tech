import { describe, expect, it } from 'vitest';
import {
	checkFor,
	connectionSettings,
	stateLabel,
	formatBytes,
	parseZone,
	passwordProblem,
	remaining,
	validDomain,
	validLocalPart
} from '../src/lib/panel/model';
import { homeFor, navFor } from '../src/lib/adapter/home';

// Shape produced by dns-update's BindSerializer (name IN TYPE value; long TXT split in parentheses).
const zone = [
	'example.com. IN MX 10 mail.shippin.tech.',
	'example.com. IN TXT "v=spf1 mx ra=postmaster -all"',
	'_dmarc.example.com. IN TXT "v=DMARC1; p=reject; rua=mailto:postmaster@example.com"',
	'202611r._domainkey.example.com. IN TXT (',
	'    "v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"',
	'    "Zm9vYmFy"',
	')',
	'_imaps._tcp.example.com. IN SRV 0 1 993 mail.shippin.tech.',
	'autoconfig.example.com. IN CNAME mail.shippin.tech.',
	'example.com. IN CAA 0 issue "letsencrypt.org"',
	''
].join('\n');

describe('parseZone', () => {
	const rows = parseZone(zone, 'example.com');

	it('lists the four records mail needs first', () => {
		expect(rows.filter((r) => r.required).map((r) => r.purpose.split(':')[0])).toEqual([
			'Receive mail',
			'SPF',
			'DMARC',
			'DKIM'
		]);
		expect(rows.slice(0, 4).every((r) => r.required)).toBe(true);
	});

	it('gives the host the way DNS providers ask for it', () => {
		const byPurpose = Object.fromEntries(rows.map((r) => [r.purpose, r]));
		expect(byPurpose['Receive mail'].host).toBe('@');
		expect(byPurpose['DMARC: policy for failed checks'].host).toBe('_dmarc');
		expect(byPurpose['DKIM: signature key'].host).toBe('202611r._domainkey');
	});

	it('joins split TXT chunks and strips quotes and trailing dots', () => {
		const dkim = rows.find((r) => r.name.includes('_domainkey'))!;
		expect(dkim.value).toBe('v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAZm9vYmFy');
		expect(rows.find((r) => r.type === 'MX')!.value).toBe('10 mail.shippin.tech');
		expect(rows.find((r) => r.type === 'TXT' && r.host === '@')!.value).toBe('v=spf1 mx ra=postmaster -all');
	});

	it('keeps optional records but marks them optional', () => {
		const optional = rows.filter((r) => !r.required).map((r) => r.type);
		expect(optional).toEqual(['SRV', 'CNAME', 'CAA']);
	});

	it('returns nothing for an empty zone', () => {
		expect(parseZone('', 'example.com')).toEqual([]);
	});
});

describe('form rules match the server', () => {
	it('accepts real domains and refuses junk', () => {
		expect(validDomain('example.com')).toBe(true);
		expect(validDomain('Mail.Example.co.uk.')).toBe(true);
		expect(validDomain('xn--bcher-kva.example')).toBe(true);
		expect(validDomain('localhost')).toBe(false);
		expect(validDomain('bad domain.com')).toBe(false);
		expect(validDomain('-bad.com')).toBe(false);
	});

	it('accepts mailbox names the server accepts', () => {
		expect(validLocalPart('jane.doe')).toBe(true);
		expect(validLocalPart('sales-eu')).toBe(true);
		// Sub-addressing is on by default, so "+" would read as sales plus a tag.
		expect(validLocalPart('sales+eu')).toBe(false);
		expect(validLocalPart('a..b')).toBe(false);
		expect(validLocalPart('.a')).toBe(false);
		expect(validLocalPart('a@b')).toBe(false);
		expect(validLocalPart('x'.repeat(65))).toBe(false);
	});

	it('explains weak or hash-like passwords', () => {
		expect(passwordProblem('short')).toMatch(/10 characters/);
		expect(passwordProblem('$argon2id$v=19$aaaa')).toMatch(/cannot start/);
		expect(passwordProblem('correct horse battery')).toBe('');
	});
});

describe('display helpers', () => {
	it('formats storage the way people read it', () => {
		expect(formatBytes(0)).toBe('0 MB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
		expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
		expect(formatBytes(20 * 1024 * 1024 * 1024)).toBe('20 GB');
	});

	it('never shows negative room left', () => {
		expect(remaining(5, 7)).toBe(0);
		expect(remaining(5, 2)).toBe(3);
	});

	it('names the server host in mail app settings', () => {
		expect(connectionSettings('mail.shippin.tech')[0].value).toContain('mail.shippin.tech, port 993');
	});
});

describe('role-based home and navigation', () => {
	it('sends each kind of account to the right place', () => {
		expect(homeFor('guest')).toBe('/login');
		expect(homeFor('owner')).toBe('/manage');
		expect(homeFor('admin')).toBe('/shippin/admin');
		expect(homeFor('user')).toBe('/mail');
	});

	it('shows customers only what they can use', () => {
		expect(navFor('guest', true).map((i) => i.href)).toEqual(['/signup']);
		expect(navFor('guest', false)).toEqual([]);
		expect(navFor('user', true).map((i) => i.href)).toEqual(['/mail', '/calendar', '/contacts', '/account']);
		expect(navFor('owner', true)[0]).toEqual({ href: '/manage', label: 'My domain' });
		expect(navFor('owner', true).map((i) => i.href)).not.toContain('/shippin/admin');
		expect(navFor('admin', true).map((i) => i.href)).toContain('/shippin/admin');
	});
});

describe('live DNS status', () => {
	const rows = parseZone(zone, 'example.com');
	const checks = [
		{ kind: 'MX', name: 'example.com', expected: 'mail.shippin.tech', state: 'found', actual: null },
		{ kind: 'SPF', name: 'example.com', expected: 'v=spf1 mx ra=postmaster -all', state: 'different', actual: 'v=spf1 include:_spf.google.com ~all' },
		{ kind: 'DKIM', name: '202611r._domainkey.example.com', expected: 'v=DKIM1', state: 'missing', actual: null }
	] as const;

	it('pairs each required row with its check', () => {
		const label = (purpose: string) => stateLabel(checkFor(rows.find((r) => r.purpose.startsWith(purpose))!, [...checks]));
		expect(label('Receive mail')).toBe('Published');
		expect(label('SPF')).toBe('Different value');
		expect(label('DKIM')).toBe('Missing');
		expect(label('DMARC')).toBe('Not checked');
	});

	it('has no check for optional rows', () => {
		expect(checkFor(rows.find((r) => r.type === 'SRV')!, [...checks])).toBeUndefined();
	});
});
