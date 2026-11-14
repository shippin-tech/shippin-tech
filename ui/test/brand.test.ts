import { describe, expect, it } from 'vitest';
import { emailDomain, logoFileProblem, logoUrl, MAX_LOGO_BYTES } from '../src/lib/shippin/org/brand-call';

describe('domain logos', () => {
	it('finds the domain once an address looks finished', () => {
		expect(emailDomain('ada@Hill.Test')).toBe('hill.test');
		expect(emailDomain(' ada@hill.test ')).toBe('hill.test');
		expect(emailDomain('ada@hill')).toBe('');
		expect(emailDomain('admin')).toBe('');
		expect(emailDomain('a@b@c.co')).toBe('');
	});

	it('builds the address of a logo', () => {
		expect(logoUrl('hill.test')).toBe('/api/brand/hill.test');
		expect(logoUrl('hill.test', 3)).toBe('/api/brand/hill.test?v=3');
	});

	it('refuses the wrong kind of file before uploading', () => {
		expect(logoFileProblem({ type: 'image/png', size: 100 })).toBe('');
		expect(logoFileProblem({ type: 'image/svg+xml', size: 100 })).toMatch(/PNG/);
		expect(logoFileProblem({ type: 'image/png', size: MAX_LOGO_BYTES + 1 })).toMatch(/90 KB/);
	});
});
