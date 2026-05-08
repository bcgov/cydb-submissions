import { test, expect } from '@playwright/test';
import { resetSubmissions, resetUsers, seedSubmissions } from './fixtures/db-helpers';

test.describe.serial('submissions table', () => {
	test.beforeAll(() => {
		resetSubmissions();
		resetUsers();
		seedSubmissions([
			{ uuid: 'sub-a', surname: 'Anderson', status: 'submitted', createdAt: '2026-01-01T00:00:00Z' },
			{ uuid: 'sub-b', surname: 'Brown', status: 'submitted', createdAt: '2026-02-01T00:00:00Z' },
			{ uuid: 'sub-c', surname: null, status: 'invalid', createdAt: '2026-03-01T00:00:00Z' }
		]);
	});

	test('default view excludes invalid', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions');
		const rows = page.locator('tbody tr');
		await expect(rows).toHaveCount(2);
		await expect(rows.first()).toContainText('Brown');
	});

	test('All filter shows the invalid row', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions');
		await page.getByRole('link', { name: /^All$/ }).click();
		await expect(page.locator('tbody tr')).toHaveCount(3);
	});

	test('clicking surname header twice sorts ascending', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions');
		await page.getByRole('link', { name: 'Surname' }).click();
		// First click sorts surname desc -> Brown then Anderson
		await expect(page.locator('tbody tr td:first-child').first()).toContainText('Brown');
		// Second click toggles to asc -> Anderson then Brown
		await page.getByRole('link', { name: 'Surname' }).click();
		await expect(page.locator('tbody tr td:first-child').first()).toContainText('Anderson');
	});
});
