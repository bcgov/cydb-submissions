import { test, expect } from '@playwright/test';

test.describe.serial('role denial', () => {
	test('clinician hitting /admin gets 403', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=clinic@test');
		const response = await page.goto('/admin');
		expect(response?.status()).toBe(403);
	});

	test('cfd_worker hitting /admin gets 403', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		const response = await page.goto('/admin');
		expect(response?.status()).toBe(403);
	});

	test('admin can reach /admin', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=admin@test');
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: /administration/i })).toBeVisible();
	});
});
