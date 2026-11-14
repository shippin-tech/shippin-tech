import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';

// Old address. A universal load, because the server only serves static files.
export function load({ params, url }: { params: { rest?: string }; url: URL }) {
	if (!browser) return;
	const rest = params.rest ? `/${params.rest}` : '';
	redirect(307, `/shippin/admin${rest}${url.search}`);
}
