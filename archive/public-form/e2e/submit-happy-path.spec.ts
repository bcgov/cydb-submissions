import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

test.describe.serial('happy path submission', () => {
	test.beforeAll(() => {
		// If local.db doesn't exist yet (fresh checkout), create it via migrate.
		// Otherwise the preview server already holds an open handle on it; deleting
		// it from outside wouldn't free the handle (writes would go to the
		// orphaned inode). Just truncate the tables in place.
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
			'DELETE FROM submission_attachments; DELETE FROM submission_metadata; DELETE FROM submissions; DELETE FROM invalid_submissions;'
		);
		sqlite.close();
		fs.rmSync(path.join(repoRoot, 'attachments'), { recursive: true, force: true });
	});

	test('user can fill, attach, and submit', async ({ page }) => {
		await page.goto('/');

		await page.getByLabel(/child.+date of birth/i).fill('2018-04-12');

		// developmentalConcerns: No
		await page
			.locator('section[aria-labelledby="devhistory-h"]')
			.getByRole('radio', { name: 'No' })
			.click();

		// hasFormalDiagnosis: Yes (required)
		await page
			.locator('section[aria-labelledby="diag-h"]')
			.getByRole('radio', { name: 'Yes' })
			.click();

		// Attachment
		await page.setInputFiles('input[type=file]', path.resolve(here, 'fixtures/sample.pdf'));

		// Consent
		await page.getByRole('checkbox', { name: /information provided is accurate/i }).click();
		await page.getByRole('checkbox', { name: /consent to the use and sharing/i }).click();

		await page.getByRole('button', { name: /submit/i }).click();

		await expect(page.getByText(/submission received\. reference: sub_/i)).toBeVisible({ timeout: 15000 });

		const sqlite = new Database(path.join(repoRoot, 'local.db'));
		const subs = sqlite.prepare('SELECT count(*) AS c FROM submissions').get() as { c: number };
		const atts = sqlite.prepare('SELECT count(*) AS c FROM submission_attachments').get() as { c: number };
		const meta = sqlite.prepare('SELECT count(*) AS c FROM submission_metadata').get() as { c: number };
		expect(subs.c).toBe(1);
		expect(atts.c).toBe(1);
		expect(meta.c).toBe(1);

		// Attachment dir exists with the original filename preserved
		const subUuid = (sqlite.prepare('SELECT submission_uuid FROM submissions LIMIT 1').get() as { submission_uuid: string }).submission_uuid;
		expect(fs.existsSync(path.join(repoRoot, 'attachments', subUuid, 'sample.pdf'))).toBe(true);
		sqlite.close();
	});
});
