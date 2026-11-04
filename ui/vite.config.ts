import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/api': 'http://127.0.0.1:8080',
			'/jmap': 'http://127.0.0.1:8080',
			'/dav': 'http://127.0.0.1:8080',
			'/scim': 'http://127.0.0.1:8080',
			'/auth': 'http://127.0.0.1:8080'
		}
	}
});
