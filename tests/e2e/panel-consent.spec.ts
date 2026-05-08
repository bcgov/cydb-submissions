import { test, expect } from '@playwright/test';

test('consent panel exposes two required checkboxes and submit button', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByLabel(/i confirm the information provided is accurate/i)).toBeVisible();
	await expect(page.getByLabel(/i consent to the use and sharing of this information/i)).toBeVisible();
	await expect(page.getByRole('button', { name: /submit/i })).toBeVisible();
});
