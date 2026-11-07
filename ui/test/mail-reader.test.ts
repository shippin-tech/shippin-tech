import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessage } from '../src/lib/adapter/mail';

afterEach(() => vi.unstubAllGlobals());

describe('mail reader', () => {
	it('requests text bodies and preserves the server truncation flag', async () => {
		const storage = new Map([
			['shippin-basic', 'token'],
			['shippin-account', JSON.stringify({ username: 'user', accountId: 'account' })]
		]);
		vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null });
		const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({
			ok: true,
			json: async () => ({ methodResponses: [['Email/get', { list: [{
				id: 'one', subject: 'Hello', preview: 'Preview',
				textBody: [{ partId: '1' }, { partId: '2' }],
				bodyValues: { '1': { value: 'First' }, '2': { value: '<script>text</script>', isTruncated: true } }
			}] }, 'e0']] })
		}));
		vi.stubGlobal('fetch', fetch);
		const message = await loadMessage('one');
		expect(message?.body).toBe('First\n\n<script>text</script>');
		expect(message?.truncated).toBe(true);
		const request = JSON.parse(String(fetch.mock.calls[0][1].body));
		expect(request.methodCalls[0][1]).toMatchObject({ ids: ['one'], fetchTextBodyValues: true });
	});
});
