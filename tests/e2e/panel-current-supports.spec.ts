import { test, expect } from '@playwright/test';

test('current supports panel exposes services + weekly hours', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(/which services is your child currently receiving\?/i)).toBeVisible();
	await expect(page.getByLabel(/approximate hours of autism-related services per week/i)).toBeVisible();
});
