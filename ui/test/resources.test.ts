import { describe, expect, it } from 'vitest';
import { bytesText, diskUsed, levelOf, percentOf, sortByAttention, type OrgUsage } from '../src/lib/shippin/resources/resources-call';

function org(overrides: Partial<OrgUsage>): OrgUsage {
	return { id: 'a', name: 'A', domains: [], people: 1, maxPeople: 10, peopleLevel: 'fine', storageUsed: 0, storageHeld: 0, maxStorage: 0, storageLevel: 'none', ...overrides };
}

describe('resource helpers', () => {
	it('writes sizes for people', () => {
		expect(bytesText(0)).toBe('0 B');
		expect(bytesText(1536)).toBe('1.5 KB');
		expect(bytesText(1024 ** 3)).toBe('1.0 GB');
		expect(bytesText(12 * 1024 ** 3)).toBe('12 GB');
	});

	it('has no percentage without a limit', () => {
		expect(percentOf(5, 0)).toBeNull();
		expect(percentOf(5, 10)).toBe(50);
		expect(percentOf(50, 10)).toBe(100);
	});

	it('matches the server about how full is full', () => {
		expect(levelOf(5, 0)).toBe('none');
		expect(levelOf(79, 100)).toBe('fine');
		expect(levelOf(80, 100)).toBe('near');
		expect(levelOf(100, 100)).toBe('over');
	});

	it('puts what needs attention first, then the biggest', () => {
		const sorted = sortByAttention([
			org({ id: 'small', name: 'Small', storageUsed: 1 }),
			org({ id: 'big', name: 'Big', storageUsed: 9 }),
			org({ id: 'near', name: 'Near', peopleLevel: 'near' }),
			org({ id: 'over', name: 'Over', storageLevel: 'over' })
		]);
		expect(sorted.map((item) => item.id)).toEqual(['over', 'near', 'big', 'small']);
	});

	it('counts a disk as used up to what is free', () => {
		expect(diskUsed({ total: 10, free: 4 })).toBe(6);
		expect(diskUsed({ total: 4, free: 10 })).toBe(0);
	});
});
