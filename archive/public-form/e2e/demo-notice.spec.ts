import { test, expect } from '@playwright/test';

test('home page shows demo notice', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('alert')).toContainText(/demonstration/i);
});
