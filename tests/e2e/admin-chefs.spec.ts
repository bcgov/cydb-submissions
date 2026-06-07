import { test, expect } from '@playwright/test';

test.describe('/admin/chefs', () => {
	test('renders the configuration form', async ({ page }) => {
		await page.goto('/admin/chefs?bypass=admin@test');
		await expect(page.getByRole('heading', { name: 'CHEFS ingestion' })).toBeVisible();
		await expect(page.getByLabel('Form ID')).toBeVisible();
		await expect(page.getByLabel('Base URL')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save configuration' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
	});

	// Run "test connection surfaces an error" BEFORE "saves a configuration" so the
	// form_id / api_token are still empty when this test fires (ConfigMissing path).
	test('test connection surfaces an error when nothing is configured', async ({ page }) => {
		await page.goto('/admin/chefs?bypass=admin@test');
		await page.getByRole('button', { name: 'Test connection' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
	});

	test('saves a configuration and persists across reloads', async ({ page, context }) => {
		// Use a valid gov.bc.ca base URL — isAllowedChefsBaseUrl requires the apex domain.
		const validBaseUrl = 'https://submit.digital.gov.bc.ca';
		// Post the save action directly rather than relying on the SvelteKit enhance
		// progressive enhancement, which is blocked by the preview server's CSP.
		await context.clearCookies();
		await page.goto('/admin/chefs?bypass=admin@test');
		const cookies = await context.cookies();
		const csrf = cookies.find((c) => c.name === 'cydb_csrf')?.value ?? '';
		const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
		const resp = await page.request.post('/admin/chefs?/save', {
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				cookie: cookieHeader
			},
			data: new URLSearchParams({
				csrf,
				formId: '11111111-2222-3333-4444-555555555555',
				baseUrl: validBaseUrl
			}).toString()
		});
		expect(resp.status()).toBe(200);
		// Reload the page and verify the config was persisted.
		await page.goto('/admin/chefs?bypass=admin@test');
		await expect(page.getByLabel('Form ID')).toHaveValue('11111111-2222-3333-4444-555555555555');
		await expect(page.getByLabel('Base URL')).toHaveValue(validBaseUrl);
	});

	test('rotating the token never echoes the secret back', async ({ page }) => {
		await page.goto('/admin/chefs?bypass=admin@test');
		await page.getByPlaceholder('paste new token').fill('secret-do-not-leak');
		await page.getByRole('button', { name: 'Rotate token' }).click();
		await expect(page.getByRole('status')).toContainText('API token rotated');
		const html = await page.content();
		expect(html).not.toContain('secret-do-not-leak');
	});
});
