import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, newSecret, otpauthUrl, totpCode, verifyCode } from '../src/lib/account/totp';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1.
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');

describe('base32', () => {
	it('round-trips and matches RFC 4648', () => {
		expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
		expect(new TextDecoder().decode(base32Decode('MZXW6YTBOI'))).toBe('foobar');
		expect(base32Decode('mzxw 6ytb oi==')).toEqual(base32Decode('MZXW6YTBOI'));
		expect(() => base32Decode('not base32!')).toThrow();
	});

	it('makes 160-bit secrets', () => {
		const secret = newSecret();
		expect(secret).toMatch(/^[A-Z2-7]{32}$/);
		expect(base32Decode(secret)).toHaveLength(20);
		expect(newSecret()).not.toBe(secret);
	});
});

describe('totpCode matches RFC 6238 SHA-1 vectors', () => {
	const vectors: [number, string][] = [
		[59, '94287082'],
		[1111111109, '07081804'],
		[1111111111, '14050471'],
		[1234567890, '89005924'],
		[2000000000, '69279037'],
		[20000000000, '65353130']
	];
	for (const [time, code] of vectors) {
		it(`at ${time}`, async () => {
			expect(await totpCode(RFC_SECRET, time, 8)).toBe(code);
			expect(await totpCode(RFC_SECRET, time, 6)).toBe(code.slice(2));
		});
	}
});

describe('verifyCode', () => {
	const secret = base32Encode(RFC_SECRET);

	it('accepts the current code and one step of drift', async () => {
		expect(await verifyCode(secret, '287082', 59)).toBe(true);
		expect(await verifyCode(secret, '287 082', 59)).toBe(true);
		expect(await verifyCode(secret, '287082', 59 + 30)).toBe(true);
	});

	it('refuses wrong, old or malformed codes', async () => {
		expect(await verifyCode(secret, '000000', 59)).toBe(false);
		expect(await verifyCode(secret, '287082', 59 + 120)).toBe(false);
		expect(await verifyCode(secret, '12345', 59)).toBe(false);
	});
});

describe('otpauthUrl', () => {
	it('uses the same issuer in the label and the parameter, as the server requires', () => {
		const url = new URL(otpauthUrl('ShippinTECH', 'owner@example.com', 'JBSWY3DPEHPK3PXP'));
		expect(url.protocol).toBe('otpauth:');
		expect(url.host).toBe('totp');
		expect(decodeURIComponent(url.pathname)).toBe('/ShippinTECH:owner@example.com');
		expect(url.searchParams.get('issuer')).toBe('ShippinTECH');
		expect(url.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
		expect(url.searchParams.get('algorithm')).toBe('SHA1');
		expect(url.searchParams.get('digits')).toBe('6');
		expect(url.searchParams.get('period')).toBe('30');
	});
});
