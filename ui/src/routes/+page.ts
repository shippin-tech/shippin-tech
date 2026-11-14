import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { currentRole, homeFor } from '$lib/adapter/home';

// The portal is served as static files by the mail server, which has no SvelteKit
// server runtime. A +page.server.ts load would make the browser fetch /__data.json
// and fail with 404, so this redirect must run as a universal load in the browser.
// Owners land on their domain, operators on the portal, mailboxes on webmail.
export async function load() {
	if (!browser) return;
	redirect(307, homeFor(await currentRole()));
}
