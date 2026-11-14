import csvSource from '../../../porting/platform-disposition.csv?raw';

export type PlatformLedgerEntry = {
	path: string;
	mode: string;
	blob: string;
	sourceGroup: string;
	disposition: string;
	destination: string;
	evidence: string;
};

let cached: PlatformLedgerEntry[] | null = null;

export function platformLedger(): PlatformLedgerEntry[] {
	if (cached) return cached;
	const rows = parseCsv(csvSource);
	cached = rows.map((row) => ({
		path: row.path ?? '',
		mode: row.mode ?? '',
		blob: row.blob ?? '',
		sourceGroup: row.source_group ?? '',
		disposition: row.disposition ?? '',
		destination: row.destination ?? '',
		evidence: row.evidence ?? ''
	}));
	return cached;
}

export function ledgerGroups(entries: readonly PlatformLedgerEntry[]): string[] {
	return [...new Set(entries.map((entry) => entry.sourceGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function ledgerDispositions(entries: readonly PlatformLedgerEntry[]): string[] {
	return [...new Set(entries.map((entry) => entry.disposition).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function dispositionCounts(entries: readonly PlatformLedgerEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) counts[entry.disposition] = (counts[entry.disposition] ?? 0) + 1;
	return counts;
}

function parseCsv(input: string): Record<string, string>[] {
	const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
	if (!lines.length) return [];
	const headers = parseCsvLine(lines[0]);
	return lines.slice(1).map((line) => {
		const values = parseCsvLine(line);
		const record: Record<string, string> = {};
		for (let index = 0; index < headers.length; index += 1) {
			record[headers[index]] = values[index] ?? '';
		}
		return record;
	});
}

function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"') {
			const escaped = quoted && line[index + 1] === '"';
			if (escaped) {
				current += '"';
				index += 1;
				continue;
			}
			quoted = !quoted;
			continue;
		}
		if (char === ',' && !quoted) {
			result.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	result.push(current);
	return result;
}
