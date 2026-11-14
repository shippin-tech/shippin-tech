import { describe, expect, it } from 'vitest';
import { dispositionCounts, ledgerDispositions, ledgerGroups, platformLedger } from '../src/lib/platform/ledger';

describe('platform ledger', () => {
	it('loads the copied disposition ledger and exposes groups/dispositions', () => {
		const entries = platformLedger();
		expect(entries.length).toBeGreaterThan(100);
		expect(entries[0]).toMatchObject({
			path: expect.any(String),
			sourceGroup: expect.any(String),
			disposition: expect.any(String),
			destination: expect.any(String)
		});
		const groups = ledgerGroups(entries);
		const dispositions = ledgerDispositions(entries);
		const counts = dispositionCounts(entries);
		expect(groups.length).toBeGreaterThan(1);
		expect(dispositions).toContain('baseline-imported');
		expect(counts['baseline-imported']).toBeGreaterThan(0);
	});
});
