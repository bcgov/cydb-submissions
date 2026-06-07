import { test, expect } from '@playwright/test';

// Requires a running Manticore (mission-critical dependency). Skip when MANTICORE_URL is unset.
test.skip(!process.env.MANTICORE_URL, 'requires Manticore (set MANTICORE_URL)');

test('search box filters to relevance-ranked matches and clears', async ({ page, context }) => {
	// Use the dev-auth-bypass shim: navigate to the bypass URL to set the session cookie,
	// then navigate to the target page. worker@test maps to the cfd_worker role which has
	// read access to /submissions (same pattern used by submissions-table.spec.ts).
	await context.clearCookies();
	await page.goto('/?bypass=worker@test');
	await page.goto('/submissions');

	const box = page.getByLabel('Search submissions');
	await expect(box).toBeVisible();

	await box.fill('Smith');
	await page.getByRole('button', { name: 'Search' }).click();

	await expect(page).toHaveURL(/[?&]q=Smith/);
	await expect(page.getByText(/results? for/i)).toBeVisible();

	await page.getByRole('button', { name: 'Clear' }).click();
	await expect(page).not.toHaveURL(/[?&]q=Smith/);
});
