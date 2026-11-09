import { loadRegistry, writeRegistry } from './portal';
import { BASELINES, baselinePatches, objectsFor, type Baseline, type BaselineRecords } from '$lib/portal/baseline';

const SINGLETON = 'singleton';

/** Reads every singleton the baselines touch. A missing object leaves its entry undefined. */
export async function loadBaselineRecords(baselines: readonly Baseline[] = BASELINES): Promise<BaselineRecords> {
	const records: BaselineRecords = {};
	await Promise.all(
		objectsFor(baselines).map(async (object) => {
			const items = await loadRegistry(object, undefined, [SINGLETON]);
			records[object] = items[0];
		})
	);
	return records;
}

/**
 * Applies a baseline. Each affected singleton gets one `/set` with only the listed properties, in
 * declaration order, so a rejected write stops before later objects change.
 */
export async function applyBaseline(baseline: Baseline, on: boolean): Promise<string[]> {
	const written: string[] = [];
	for (const [object, patch] of Object.entries(baselinePatches(baseline, on))) {
		await writeRegistry(object, { update: { [SINGLETON]: patch } }, SINGLETON);
		written.push(object);
	}
	return written;
}
