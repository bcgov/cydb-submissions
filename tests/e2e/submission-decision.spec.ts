import { test, expect } from '@playwright/test';
import { seedDecidableSubmission, deleteSubmission } from './fixtures/db-helpers';

const SUBMISSION_UUID = 'e2e-dec-1';

test.describe.serial('submission decision flow', () => {
	test.beforeAll(() => {
		deleteSubmission(SUBMISSION_UUID);
		seedDecidableSubmission(SUBMISSION_UUID);
	});

	test.afterAll(() => {
		deleteSubmission(SUBMISSION_UUID);
	});

	test('reject flow: cfd_worker can reject a submission with a reason', async ({
		page,
		context
	}) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		await page.goto(`/submissions/${SUBMISSION_UUID}`);

		// Accept and Reject radios should be visible (no decision yet)
		await expect(page.getByRole('radio', { name: /accept/i })).toBeVisible();
		await expect(page.getByRole('radio', { name: /reject/i })).toBeVisible();

		// Click the Reject radio
		await page.getByRole('radio', { name: /reject/i }).click();

		// Reason checkboxes appear after choosing Reject — each reason is a <label> wrapping a checkbox.
		const firstReasonLabel = page
			.locator('label')
			.filter({ has: page.getByRole('checkbox') })
			.first();
		await expect(firstReasonLabel).toBeVisible();
		const reasonText = (await firstReasonLabel.textContent())?.trim() ?? '';
		expect(reasonText).toBeTruthy(); // the locator must have found a real reason

		// Tick the first reason
		await firstReasonLabel.getByRole('checkbox').check();

		// Click "Record decision" button
		await page.getByRole('button', { name: /record decision/i }).click();

		// Wait for the AlertDialog and confirm
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: /confirm/i }).click();

		// Success banner appears
		await expect(page.getByRole('status')).toBeVisible();

		// Page now shows "Rejected" badge indicator (the Badge component)
		await expect(page.getByText('Rejected', { exact: true })).toBeVisible();

		// The chosen reason text appears in the recorded decision
		await expect(page.getByText(reasonText).first()).toBeVisible();

		// Accept/Reject radios are GONE (decision recorded)
		await expect(page.getByRole('radio', { name: /accept/i })).not.toBeVisible();
		await expect(page.getByRole('radio', { name: /reject/i })).not.toBeVisible();
	});

	test('admin reset: admin can reset a decided submission', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto(`/submissions/${SUBMISSION_UUID}?bypass=admin@test`);

		// Reset decision button is present
		const resetButton = page.getByRole('button', { name: /reset decision/i });
		await expect(resetButton).toBeVisible();

		// Click reset
		await resetButton.click();

		// Confirm in the AlertDialog
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: /reset/i }).click();

		// Success banner appears
		await expect(page.getByRole('status')).toBeVisible();

		// Accept/Reject radios are BACK (decision cleared)
		await expect(page.getByRole('radio', { name: /accept/i })).toBeVisible();
		await expect(page.getByRole('radio', { name: /reject/i })).toBeVisible();
	});
});
