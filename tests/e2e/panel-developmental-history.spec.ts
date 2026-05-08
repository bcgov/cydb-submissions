import { test, expect } from '@playwright/test';

test('age field appears only when concerns is yes', async ({ page }) => {
	await page.goto('/');
	const panel = page.locator('section[aria-labelledby="devhistory-h"]');
	await expect(page.getByLabel('At what age were concerns first noticed?')).toBeHidden();
	await panel.getByRole('radio', { name: 'Yes' }).click();
	await expect(page.getByLabel('At what age were concerns first noticed?')).toBeVisible();
	await panel.getByRole('radio', { name: 'No' }).click();
	await expect(page.getByLabel('At what age were concerns first noticed?')).toBeHidden();
});
