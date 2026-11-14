import { describe, expect, it } from 'vitest';
import { maskedCount, maskedLocal, maskedName, maskedStatus } from '../src/lib/adapter/masked-call';

describe('masked address helpers', () => {
	it('finds the part before the @', () => {
		expect(maskedLocal('abcdefghjkmn@example.org')).toBe('abcdefghjkmn');
	});

	it('names an address with no label', () => {
		expect(maskedName({ label: '  ' })).toBe('No label');
		expect(maskedName({ label: 'Shops' })).toBe('Shops');
	});

	it('says what it does right now', () => {
		expect(maskedStatus(true)).toMatch(/Inbox/);
		expect(maskedStatus(false)).toMatch(/refused/);
		expect(maskedCount(2, 50)).toBe('2 of 50 used');
	});
});
