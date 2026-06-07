import { test, expect } from '@playwright/test';
import { seedSubmissions } from './fixtures/db-helpers';

test.describe.serial('submission detail page', () => {
	test.beforeAll(() => {
		seedSubmissions([
			{ uuid: 'sub-detail', surname: 'Doe', status: 'submitted', createdAt: '2026-04-01T00:00:00Z' }
		]);
	});

	test('detail page renders all panel sections', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions/sub-detail');
		await expect(page.getByRole('heading', { name: /child \/ youth/i })).toBeVisible();
		await expect(page.getByRole('heading', { name: /agreement signatory/i })).toBeVisible();
		await expect(page.getByRole('heading', { name: /screening/i })).toBeVisible();
		await expect(page.getByRole('heading', { name: /assessments/i })).toBeVisible();
		await expect(page.getByRole('heading', { name: /signature/i })).toBeVisible();
		await expect(page.getByRole('heading', { name: /attachments \(0\)/i })).toBeVisible();
	});

	test('detail page 404s for unknown uuid', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		const response = await page.goto('/submissions/does-not-exist');
		expect(response?.status()).toBe(404);
	});
});
