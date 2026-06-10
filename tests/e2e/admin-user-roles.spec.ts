import { test, expect } from '@playwright/test';
import { seedUserWithRole, deleteUser } from './fixtures/db-helpers';

const TEST_USER_ID = 'e2e-clin-1';
const TEST_USER_EMAIL = 'e2e-clinician@test.local';
const TEST_ROLE = 'clinician';

async function gotoAdminUsers(
	page: import('@playwright/test').Page,
	context: import('@playwright/test').BrowserContext
) {
	await context.clearCookies();
	await page.goto('/?bypass=admin@test');
	await page.goto('/admin/users');
}

test.describe.serial('admin /admin/users revoke/restore flow', () => {
	test.beforeAll(() => {
		deleteUser(TEST_USER_ID);
		seedUserWithRole(TEST_USER_ID, TEST_USER_EMAIL, TEST_ROLE);
	});

	test.afterAll(() => {
		deleteUser(TEST_USER_ID);
	});

	test('seeded user appears with clinician in Granted and Effective', async ({ page, context }) => {
		await gotoAdminUsers(page, context);
		const row = page.locator('tr', { hasText: TEST_USER_EMAIL });
		await expect(row).toBeVisible();

		// Granted column: second <td> in the row
		const grantedCell = row.locator('td').nth(1);
		await expect(grantedCell).toContainText(TEST_ROLE);

		// Effective column: fourth <td> in the row
		const effectiveCell = row.locator('td').nth(3);
		await expect(effectiveCell).toContainText(TEST_ROLE);
	});

	test('Revoke flow: dialog appears, confirm revokes the role', async ({ page, context }) => {
		await gotoAdminUsers(page, context);
		const row = page.locator('tr', { hasText: TEST_USER_EMAIL });
		await expect(row).toBeVisible();

		// Click the Revoke button for the clinician role
		await row.getByRole('button', { name: `Revoke ${TEST_ROLE}` }).click();

		// Wait for the AlertDialog to appear
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();

		// Confirm the revoke
		await dialog.getByRole('button', { name: 'Revoke' }).click();

		// Success banner
		await expect(page.getByRole('status')).toContainText(/revoked/i);

		// Row should now show clinician in Revoked (third column), not in Effective (fourth column)
		const updatedRow = page.locator('tr', { hasText: TEST_USER_EMAIL });

		const revokedCell = updatedRow.locator('td').nth(2);
		await expect(revokedCell).toContainText(TEST_ROLE);

		const effectiveCell = updatedRow.locator('td').nth(3);
		await expect(effectiveCell).not.toContainText(TEST_ROLE);
	});

	test('Restore flow: clicking Restore returns clinician to Effective', async ({
		page,
		context
	}) => {
		await gotoAdminUsers(page, context);
		const row = page.locator('tr', { hasText: TEST_USER_EMAIL });
		await expect(row).toBeVisible();

		// Click the Restore button
		await row.getByRole('button', { name: `Restore ${TEST_ROLE}` }).click();

		// Success banner
		await expect(page.getByRole('status')).toContainText(/restored/i);

		// clinician should be back in Effective, not in Revoked
		const updatedRow = page.locator('tr', { hasText: TEST_USER_EMAIL });

		const effectiveCell = updatedRow.locator('td').nth(3);
		await expect(effectiveCell).toContainText(TEST_ROLE);

		const revokedCell = updatedRow.locator('td').nth(2);
		await expect(revokedCell).not.toContainText(TEST_ROLE);
	});
});
