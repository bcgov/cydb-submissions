import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function submissionCount(): number {
	const db = new Database(path.join(repoRoot, 'local.db'));
	const row = db.prepare(`SELECT count(*) as n FROM submissions`).get() as { n: number };
	db.close();
	return row.n;
}

/**
 * Open the admin page as an admin and return to a clean cookie state.
 * Hydration runs (kit.csp adds a nonce to the inline bootstrap), so the
 * bits-ui AlertDialog confirmations work in preview.
 */
async function gotoAdmin(
	page: import('@playwright/test').Page,
	context: import('@playwright/test').BrowserContext
) {
	await context.clearCookies();
	await page.goto('/?bypass=admin@test');
	await page.goto('/admin');
}

test.describe.serial('admin seed + clear', () => {
	test('Seed button (after confirmation) populates submissions', async ({ page, context }) => {
		await gotoAdmin(page, context);
		await page.getByRole('button', { name: 'Seed mock submissions' }).click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Seed', exact: true }).click();
		await expect(page.getByRole('status')).toContainText(/Seeded/);
		expect(submissionCount()).toBeGreaterThan(0);
	});

	test('Clear button (after confirmation) empties submissions', async ({ page, context }) => {
		await gotoAdmin(page, context);
		await page.getByRole('button', { name: 'Clear all submissions' }).click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Clear all', exact: true }).click();
		await expect(page.getByRole('status')).toContainText(/cleared/i);
		expect(submissionCount()).toBe(0);
	});

	test('Cancel on the seed dialog leaves the DB unchanged', async ({ page, context }) => {
		await gotoAdmin(page, context);
		// First ensure there are some submissions so the "before" count is non-zero.
		await page.getByRole('button', { name: 'Seed mock submissions' }).click();
		let dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Seed', exact: true }).click();
		await expect(page.getByRole('status')).toContainText(/Seeded/);
		const before = submissionCount();
		expect(before).toBeGreaterThan(0);

		// Open the seed dialog again and Cancel — the seed action must not fire.
		await page.getByRole('button', { name: 'Seed mock submissions' }).click();
		dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).not.toBeVisible();
		expect(submissionCount()).toBe(before);
	});
});
