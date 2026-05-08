import { test, expect } from '@playwright/test';

test('age field appears only when concerns is yes', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByLabel('At what age were concerns first noticed?')).toBeHidden();
	await page.getByRole('radio', { name: 'Yes' }).click();
	await expect(page.getByLabel('At what age were concerns first noticed?')).toBeVisible();
	await page.getByRole('radio', { name: 'No' }).click();
	await expect(page.getByLabel('At what age were concerns first noticed?')).toBeHidden();
});
