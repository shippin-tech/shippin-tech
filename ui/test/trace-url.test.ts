import { describe, expect, it } from 'vitest';
import { tracingStreamUrl } from '../src/lib/portal/trace';

describe('live tracing stream', () => {
	it('asks our own endpoint with the level, keyword and key filters', () => {
		expect(tracingStreamUrl('', 'mx', [])).toBe('');
		const url = new URL(
			tracingStreamUrl('tok', ' example.org ', [
				{ key: 'level', value: 'trace' },
				{ key: 'remoteIp', value: '10.0.0.1' },
				{ key: 'accountName', value: ' ' },
				{ key: 'token', value: 'stolen' }
			]),
			'http://x'
		);
		expect(url.pathname).toBe('/api/trace/live');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			token: 'tok',
			filter: 'example.org',
			level: 'trace',
			remoteIp: '10.0.0.1'
		});
	});
});
