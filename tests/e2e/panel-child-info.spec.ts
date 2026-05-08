import { test, expect } from '@playwright/test';

test('child info panel exposes DOB and primary language', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByLabel(/child.+date of birth/i)).toBeVisible();
	await expect(page.getByLabel(/primary language spoken at home/i)).toBeVisible();
});
