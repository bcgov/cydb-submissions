import { test, expect } from '@playwright/test';

test('co-occurring conditions panel lists checkboxes', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(/has your child been diagnosed with any of the following\?/i)).toBeVisible();
	const items = page.locator('section[aria-labelledby="cooc-h"] [role="checkbox"]');
	expect(await items.count()).toBeGreaterThanOrEqual(3);
});
