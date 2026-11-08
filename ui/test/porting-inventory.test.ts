import { describe, expect, it } from 'vitest';
import { inventoryStatusCounts, packageBacklog, portingQueue, webuiInventory } from '../src/lib/porting/inventory';

describe('porting inventory', () => {
	it('loads queue + webui inventory and computes status/backlog counts', () => {
		const queue = portingQueue();
		const inventory = webuiInventory();
		expect(queue.packages.length).toBeGreaterThan(10);
		expect(inventory.files.length).toBe(57);
		const statuses = inventoryStatusCounts(inventory.files);
		expect(statuses.partial).toBeGreaterThan(0);
		const backlog = packageBacklog(inventory.files);
		expect(backlog.P5).toBeGreaterThan(0);
	});
});
