import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

test.describe.serial('OCR happy path', () => {
	test.beforeAll(() => {
		const dbPath = path.join(repoRoot, 'local.db');
		if (!fs.existsSync(dbPath)) {
			execSync('npm run db:migrate', {
				cwd: repoRoot,
				env: { ...process.env, DATABASE_URL: 'local.db' },
				stdio: 'pipe'
			});
		}
		const sqlite = new Database(dbPath);
		sqlite.pragma('foreign_keys = ON');
		sqlite.exec(
			'DELETE FROM keyword_hits; DELETE FROM ocr_results; DELETE FROM ocr_jobs; ' +
				'DELETE FROM submission_attachments; DELETE FROM submission_metadata; ' +
				'DELETE FROM submissions; DELETE FROM invalid_submissions; ' +
				`DELETE FROM system_state WHERE key='ocr.halted';`
		);
		sqlite.close();
		fs.rmSync(path.join(repoRoot, 'attachments'), { recursive: true, force: true });
	});

	test('submission with attachment becomes OCR processed and records keyword hits', async ({ page }) => {
		await page.goto('/');
		await page.getByLabel(/child.+date of birth/i).fill('2018-04-12');
		await page
			.locator('section[aria-labelledby="devhistory-h"]')
			.getByRole('radio', { name: 'No' })
			.click();
		await page
			.locator('section[aria-labelledby="diag-h"]')
			.getByRole('radio', { name: 'Yes' })
			.click();
		await page.setInputFiles('input[type=file]', path.resolve(here, 'fixtures/sample.pdf'));
		await page.getByRole('checkbox', { name: /information provided is accurate/i }).click();
		await page.getByRole('checkbox', { name: /consent to the use and sharing/i }).click();
		await page.getByRole('button', { name: /submit/i }).click();
		await expect(page.getByText(/submission received\. reference: sub_/i)).toBeVisible({ timeout: 15000 });

		const dbPath = path.join(repoRoot, 'local.db');
		const sqlite = new Database(dbPath);
		// Poll for the worker to flip status to "OCR processed".
		const deadline = Date.now() + 15000;
		let status = '';
		while (Date.now() < deadline) {
			const row = sqlite.prepare('SELECT status FROM submissions LIMIT 1').get() as { status: string } | undefined;
			status = row?.status ?? '';
			if (status === 'OCR processed') break;
			await new Promise((r) => setTimeout(r, 250));
		}
		expect(status).toBe('OCR processed');

		const hits = sqlite.prepare('SELECT keyword, count FROM keyword_hits').all() as Array<{ keyword: string; count: number }>;
		// Sample fixture contains autism, BCAAN, Vineland, ADHD, speech.
		expect(hits.find((h) => h.keyword === 'autism')?.count).toBeGreaterThanOrEqual(1);
		expect(hits.find((h) => h.keyword === 'BCAAN')?.count).toBeGreaterThanOrEqual(1);

		const job = sqlite.prepare('SELECT status, attempts FROM ocr_jobs LIMIT 1').get() as { status: string; attempts: number };
		expect(job.status).toBe('succeeded');

		sqlite.close();
	});
});
