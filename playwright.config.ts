import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.spec.ts',
	webServer: {
		command: 'npm run dev -- --port 4173',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	},
	use: {
		baseURL: 'http://localhost:4173'
	}
});
