import { redirect } from '@sveltejs/kit';

// The portal is served as static files by the mail server, which has no SvelteKit
// server runtime. A +page.server.ts load would make the browser fetch /__data.json
// and fail with 404, so this redirect must run as a universal load in the browser.
export function load() {
	redirect(307, '/portal');
}
