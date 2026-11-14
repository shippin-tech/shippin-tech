import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';

// Old bookmarks and links to the retired /admin app open the portal instead.
export function load() {
	if (browser) redirect(307, '/shippin/admin');
}
