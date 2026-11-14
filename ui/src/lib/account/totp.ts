/**
 * Time-based one-time codes (RFC 6238, SHA-1, 6 digits, 30 seconds), the format the
 * server's two-factor check (totp-rs, strict mode) accepts. The secret is created in
 * the browser; the page checks a code against it before the server ever stores it,
 * so a mistyped setup cannot lock the account.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

export function base32Decode(text: string): Uint8Array {
	const clean = text.replace(/[\s=-]/g, '').toUpperCase();
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const char of clean) {
		const index = ALPHABET.indexOf(char);
		if (index < 0) throw new Error('Not a base32 secret.');
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

/** 160 random bits, above the 128-bit minimum the server enforces. */
export function newSecret(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
	return base32Encode(random(new Uint8Array(20)));
}

/** otpauth link for authenticator apps. The label issuer must equal the issuer parameter. */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
	const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
	return `otpauth://totp/${label}?${params.toString()}`;
}

export async function totpCode(secretBytes: Uint8Array, unixSeconds: number, digits = 6, period = 30): Promise<string> {
	const counter = Math.floor(unixSeconds / period);
	const message = new Uint8Array(8);
	let rest = counter;
	for (let index = 7; index >= 0; index -= 1) {
		message[index] = rest & 255;
		rest = Math.floor(rest / 256);
	}
	const key = await crypto.subtle.importKey('raw', new Uint8Array(secretBytes), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
	const offset = mac[mac.length - 1] & 15;
	const binary =
		((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
	return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Accepts the current code or one step either side, to allow for clock drift. */
export async function verifyCode(secret: string, code: string, nowSeconds = Date.now() / 1000): Promise<boolean> {
	const wanted = code.replace(/\s/g, '');
	if (!/^\d{6}$/.test(wanted)) return false;
	const bytes = base32Decode(secret);
	for (const drift of [0, -30, 30]) {
		if ((await totpCode(bytes, nowSeconds + drift)) === wanted) return true;
	}
	return false;
}
