import { test, expect } from '@playwright/test';
import { resetUsers } from './fixtures/db-helpers';

test.describe.serial('auth bypass shim', () => {
	test.beforeAll(() => {
		resetUsers();
	});

	test('admin bypass can reach /admin', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=admin@test');
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: /administration/i })).toBeVisible();
	});

	test('cfd_worker bypass lands on /submissions', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions');
		await expect(page.getByRole('heading', { name: /^submissions$/i })).toBeVisible();
	});

	test('clinician bypass lands on /clinician with empty-state copy', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=clinic@test');
		await page.goto('/clinician');
		await expect(page.getByText(/no submissions visible to you yet/i)).toBeVisible();
	});
});
