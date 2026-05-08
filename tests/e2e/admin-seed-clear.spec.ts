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

test.describe.serial('admin seed + clear', () => {
	test('Seed button (after confirmation) populates submissions', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=admin@test');
		await page.goto('/admin');
		await page.getByRole('button', { name: /^Seed mock submissions$/ }).click();
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await page.getByRole('button', { name: /^Seed$/ }).click();
		await expect(page.getByRole('status')).toContainText(/Seeded \d+ submissions/);
		expect(submissionCount()).toBeGreaterThan(0);
	});

	test('Clear button (after confirmation) empties submissions', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=admin@test');
		await page.goto('/admin');
		await page.getByRole('button', { name: /^Clear all submissions$/ }).click();
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await page.getByRole('button', { name: /^Clear all$/ }).click();
		await expect(page.getByRole('status')).toContainText(/cleared/i);
		expect(submissionCount()).toBe(0);
	});

	test('Cancel on the seed dialog leaves the DB unchanged', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=admin@test');
		await page.goto('/admin');
		const before = submissionCount();
		await page.getByRole('button', { name: /^Seed mock submissions$/ }).click();
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await page.getByRole('button', { name: /^Cancel$/ }).click();
		await expect(page.getByRole('alertdialog')).toBeHidden();
		expect(submissionCount()).toBe(before);
	});
});
