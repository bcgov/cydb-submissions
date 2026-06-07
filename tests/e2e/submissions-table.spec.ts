import { test, expect } from '@playwright/test';
import { seedSubmissions } from './fixtures/db-helpers';

test.describe.serial('submissions table', () => {
	test.beforeAll(() => {
		seedSubmissions([
			{
				uuid: 'sub-a',
				surname: 'Anderson',
				status: 'submitted',
				createdAt: '2026-01-01T00:00:00Z'
			},
			{ uuid: 'sub-b', surname: 'Brown', status: 'submitted', createdAt: '2026-02-01T00:00:00Z' },
			{ uuid: 'sub-c', surname: null, status: 'invalid', createdAt: '2026-03-01T00:00:00Z' }
		]);
	});

	test('default view excludes invalid sub-c', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions?size=100');
		await expect(page.getByRole('row', { name: /Anderson/ })).toBeVisible();
		await expect(page.getByRole('row', { name: /Brown/ })).toBeVisible();
		// sub-c is invalid + the only invalid row containing the empty-surname placeholder marker for our seed
		await expect(page.locator('tbody').getByText(/invalid/)).toHaveCount(0);
	});

	test('All filter exposes invalid rows', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions?size=100');
		await page.getByRole('link', { name: /^All$/ }).click();
		await expect(page.locator('tbody').getByText('invalid').first()).toBeVisible();
	});

	test('surname sort respects asc/desc URL params', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto('/submissions?size=100&status=submitted&sort=surname&order=desc');
		// Signatory surname is the 3rd column (after Submitted and Child)
		const desc = await page.locator('tbody tr td:nth-child(3)').allTextContents();
		expect(desc.indexOf('Brown')).toBeGreaterThanOrEqual(0);
		expect(desc.indexOf('Anderson')).toBeGreaterThanOrEqual(0);
		expect(desc.indexOf('Brown')).toBeLessThan(desc.indexOf('Anderson'));
		await page.goto('/submissions?size=100&status=submitted&sort=surname&order=asc');
		const asc = await page.locator('tbody tr td:nth-child(3)').allTextContents();
		expect(asc.indexOf('Anderson')).toBeLessThan(asc.indexOf('Brown'));
	});
});
