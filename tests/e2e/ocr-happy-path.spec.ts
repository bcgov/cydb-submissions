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

	test('submission with attachment becomes OCR processed and records keyword hits', async ({
		page
	}) => {
		// Seed a submission using the new schema, then create an OCR job directly.
		// The form UI is no longer embedded in the app (submissions arrive via CHEFS sync);
		// we exercise the OCR worker pipeline by seeding a submission + attachment + job.
		const dbPath = path.join(repoRoot, 'local.db');
		const sqlite = new Database(dbPath);
		sqlite.pragma('foreign_keys = ON');

		const subUuid = `ocr-happy-${Date.now()}`;
		const subRes = sqlite
			.prepare(
				`INSERT INTO submissions (
					submission_uuid, status,
					child_youth_first_name, child_youth_last_name, child_youth_dob, child_youth_gender,
					signatory_first_name, signatory_last_name, signatory_dob, signatory_gender,
					signatory_relationship, primary_phone, email,
					screening, primary_care_and_control, signature, date_signed,
					raw_payload
				) VALUES (
					?, 'submitted',
					'Test', 'Subject', '2015-06-01', 'nonBinaryPerson',
					'Pat', 'Subject', '1985-02-20', 'womanGirl',
					'Parent', '250-555-0100', 'ocr@example.com',
					'Yes', 1, 'data:image/png;base64,AAAA', '2026-06-01',
					'{}'
				)`
			)
			.run(subUuid);
		const submissionId = Number(subRes.lastInsertRowid);

		// Point the stored_path to the sample.pdf fixture — the stub OCR provider
		// derives the fixture text from the file basename ("sample" → sample.txt).
		const samplePdf = path.resolve(here, 'fixtures/sample.pdf');
		const attRes = sqlite
			.prepare(
				`INSERT INTO submission_attachments
					(submission_id, original_filename, stored_path, size_bytes, mime_type, sha256)
				 VALUES (?, 'sample.pdf', ?, 1024, 'application/pdf', 'deadbeef')`
			)
			.run(submissionId, samplePdf);
		const attachmentId = Number(attRes.lastInsertRowid);

		// Enqueue the OCR job.
		sqlite
			.prepare(`INSERT INTO ocr_jobs (attachment_id, status) VALUES (?, 'queued')`)
			.run(attachmentId);
		sqlite.close();

		// Wake up the running preview server so it processes the job.
		// A simple GET is enough — the worker polls on its own interval.
		await page.goto('/');

		// Poll for the worker to flip status to "OCR processed" (up to 15 s).
		const sqlite2 = new Database(dbPath);
		const deadline = Date.now() + 15000;
		let status = '';
		while (Date.now() < deadline) {
			const row = sqlite2
				.prepare('SELECT status FROM submissions WHERE submission_uuid = ?')
				.get(subUuid) as { status: string } | undefined;
			status = row?.status ?? '';
			if (status === 'OCR processed') break;
			await new Promise((r) => setTimeout(r, 250));
		}
		expect(status).toBe('OCR processed');

		const hits = sqlite2.prepare('SELECT keyword, count FROM keyword_hits').all() as Array<{
			keyword: string;
			count: number;
		}>;
		// sample.txt contains autism, BCAAN, Vineland, ADHD, speech.
		expect(hits.find((h) => h.keyword === 'autism')?.count).toBeGreaterThanOrEqual(1);
		expect(hits.find((h) => h.keyword === 'BCAAN')?.count).toBeGreaterThanOrEqual(1);

		const job = sqlite2
			.prepare('SELECT status, attempts FROM ocr_jobs WHERE attachment_id = ?')
			.get(attachmentId) as { status: string; attempts: number };
		expect(job.status).toBe('succeeded');

		sqlite2.close();
	});
});
