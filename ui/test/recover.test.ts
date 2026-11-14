import { describe, expect, it } from 'vitest';
import { keptFor, keptIntro, messageSize, subjectOrPlaceholder } from '../src/lib/shippin/recover/recover-call';

describe('recovery helpers', () => {
	it('counts the days left, rounding up', () => {
		expect(keptFor(86400 * 3, 0)).toBe('Kept for 3 more days');
		expect(keptFor(86400 * 2 + 1, 0)).toBe('Kept for 3 more days');
		expect(keptFor(100, 0)).toBe('Kept for 1 more day');
		expect(keptFor(0, 100)).toBe('Going away today');
	});

	it('says how long the server keeps things', () => {
		expect(keptIntro(30)).toBe('Deleted accounts and messages are kept for 30 days.');
		expect(keptIntro(1)).toBe('Deleted accounts and messages are kept for 1 day.');
		expect(keptIntro(0)).toMatch(/not being kept/);
	});

	it('writes sizes for people', () => {
		expect(messageSize(512)).toBe('512 B');
		expect(messageSize(2048)).toBe('2 KB');
		expect(messageSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
	});

	it('names a message with no subject', () => {
		expect(subjectOrPlaceholder('  ')).toBe('No subject');
		expect(subjectOrPlaceholder('Invoice')).toBe('Invoice');
	});
});
