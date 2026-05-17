import { test, expect } from '@playwright/test';

test('functional impact panel exposes four severity selects', async ({ page }) => {
	await page.goto('/');
	for (const lbl of [
		'Communication difficulties',
		'Social interaction difficulties',
		'Daily living skills challenges',
		'Behavioural regulation concerns'
	]) {
		await expect(page.getByLabel(lbl)).toBeVisible();
	}
});
