import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

test.describe.serial('admin /admin/ocr', () => {
	test.beforeEach(() => {
		const sqlite = new Database(path.join(repoRoot, 'local.db'));
		sqlite.exec(`DELETE FROM system_state WHERE key='ocr.halted';`);
		// Pre-set the halt sentinel so the page renders the banner.
		sqlite
			.prepare(
				`INSERT INTO system_state (key, value) VALUES ('ocr.halted', ?)
				 ON CONFLICT(key) DO UPDATE SET value=excluded.value`
			)
			.run(
				JSON.stringify({
					trippedAt: '2026-05-08T12:00:00.000Z',
					threshold: 4,
					jobIds: [101, 102, 103, 104],
					lastErrorClass: 'OcrProviderError'
				})
			);
		sqlite.close();
	});

	test.afterAll(() => {
		const sqlite = new Database(path.join(repoRoot, 'local.db'));
		sqlite.exec(`DELETE FROM system_state WHERE key='ocr.halted';`);
		sqlite.close();
	});

	test('admin sees the halt banner and can resume the queue', async ({ page }) => {
		await page.goto('/admin/ocr?bypass=admin@test:admin');
		await expect(page.getByText(/Queue halted at/)).toBeVisible();
		await expect(page.getByText('OcrProviderError')).toBeVisible();

		await page.getByRole('button', { name: /^Resume queue$/ }).click();
		// Confirmation dialog
		await page.getByRole('button', { name: /^Resume queue$/ }).nth(1).click();

		await expect(page.getByText(/Queue resumed\./i)).toBeVisible({ timeout: 5000 });
		await expect(page.getByText(/Queue halted at/)).toBeHidden();

		const sqlite = new Database(path.join(repoRoot, 'local.db'));
		const row = sqlite.prepare(`SELECT 1 FROM system_state WHERE key='ocr.halted'`).get();
		expect(row).toBeUndefined();
		sqlite.close();
	});
});
