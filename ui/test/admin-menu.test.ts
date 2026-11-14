import { describe, expect, it } from 'vitest';
import { ADMIN_MENU, isCurrent, settingsMenu } from '../src/lib/shippin/admin/menu';

describe('the admin menu', () => {
	it('links only inside the admin panel, once each', () => {
		const hrefs = ADMIN_MENU.flatMap((group) => group.links.map((link) => link.href));
		expect(new Set(hrefs).size).toBe(hrefs.length);
		for (const href of hrefs) expect(href.startsWith('/shippin/admin')).toBe(true);
	});

	it('marks only the exact page as current', () => {
		expect(isCurrent('/shippin/admin', '/shippin/admin')).toBe(true);
		expect(isCurrent('/shippin/admin/orgs', '/shippin/admin')).toBe(false);
	});

	it('keeps our own screens out of All settings and drops what is left empty', () => {
		const menu = settingsMenu([
			{ name: 'Management', items: [{ name: 'Dashboard', view: 'CustomComponent/Dashboard', children: [] }, { name: 'Domains', view: 'x:Domain', children: [] }] },
			{ name: 'Telemetry', items: [{ name: 'Live', view: '', children: [{ name: 'Tracing', view: 'CustomComponent/LiveTracing' }] }] }
		]);
		expect(menu).toEqual([{ name: 'Management', items: [{ name: 'Domains', view: 'x:Domain', children: [] }] }]);
	});
});
