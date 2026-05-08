import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.spec.ts',
	globalSetup: './tests/e2e/global-setup.ts',
	workers: 1,
	webServer: {
		command:
			'node scripts/migrate.mjs && npm run build && npm run preview -- --port 4173',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 240_000,
		env: {
			DEV_AUTH_BYPASS:
				process.env.DEV_AUTH_BYPASS ??
				'admin@test:admin,worker@test:cfd_worker,clinic@test:clinician'
		}
	},
	use: {
		baseURL: 'http://localhost:4173'
	}
});
