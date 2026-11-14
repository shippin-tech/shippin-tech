import queueSource from '../../../porting/work-packages.json?raw';
import filesSource from '../../../porting/webui-files.json?raw';

export type PortingPackage = {
	id: string;
	track: string;
	title: string;
	status: string;
	depends_on: string[];
	batches: string[];
	acceptance: string[];
};

export type PortingQueue = {
	version: number;
	scope: string;
	focus: string;
	next_by_track: Record<string, string>;
	packages: PortingPackage[];
};

export type InventoryFile = {
	source: string;
	sha256: string;
	owners: string[];
	status: string;
	remaining: string;
	work_packages: string[];
};

export type InventoryDocument = {
	scope: string;
	files: InventoryFile[];
};

let cachedQueue: PortingQueue | null = null;
let cachedInventory: InventoryDocument | null = null;

export function portingQueue(): PortingQueue {
	if (cachedQueue) return cachedQueue;
	const parsed = JSON.parse(queueSource) as PortingQueue;
	cachedQueue = parsed;
	return parsed;
}

export function webuiInventory(): InventoryDocument {
	if (cachedInventory) return cachedInventory;
	const parsed = JSON.parse(filesSource) as InventoryDocument;
	cachedInventory = parsed;
	return parsed;
}

export function inventoryStatusCounts(files: readonly InventoryFile[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1;
	return counts;
}

export function packageBacklog(
	files: readonly InventoryFile[],
	statuses = new Set(['partial', 'planned', 'unimplemented'])
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const file of files) {
		if (!statuses.has(file.status)) continue;
		for (const id of file.work_packages) counts[id] = (counts[id] ?? 0) + 1;
	}
	return counts;
}
