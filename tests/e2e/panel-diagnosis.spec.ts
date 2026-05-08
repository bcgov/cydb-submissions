import { test, expect } from '@playwright/test';

test('diagnosis panel renders all three controls', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(/has your child received a formal autism diagnosis\?/i)).toBeVisible();
	await expect(page.getByLabel('Diagnostic status')).toBeVisible();
	await expect(page.getByText(/assessment tools used \(if known\)/i)).toBeVisible();
});
