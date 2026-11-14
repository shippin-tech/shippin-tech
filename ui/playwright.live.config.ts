import { defineConfig, devices } from '@playwright/test';

// Drives the real local Docker stack (deploy/local). Start it first:
//   ./deploy/local/start.ps1   then   npm run test:live
export default defineConfig({
	testDir: 'e2e-live',
	globalSetup: './e2e-live/global-setup.ts',
	timeout: 120_000,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: process.env.LIVE_URL ?? 'http://127.0.0.1:28080',
		...devices['Desktop Chrome'],
		trace: 'retain-on-failure'
	}
});
