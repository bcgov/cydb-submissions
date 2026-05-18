import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function openDb() {
	return new Database(path.join(repoRoot, 'local.db'));
}

function seedFailedJobs(): { submissionId: number; jobIds: number[] } {
	const sqlite = openDb();
	const subUuid = `queues-spec-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
	const subRes = sqlite
		.prepare(
			`INSERT INTO submissions (submission_uuid, "informationAccurate", "dataSharingConsent", raw_payload)
			 VALUES (?, 1, 1, '{}')`
		)
		.run(subUuid);
	const submissionId = Number(subRes.lastInsertRowid);
	const attRes1 = sqlite
		.prepare(
			`INSERT INTO submission_attachments
				(submission_id, original_filename, stored_path, size_bytes, mime_type, sha256)
			 VALUES (?, 'a.pdf', '/x/a.pdf', 1, 'application/pdf', 'h1')`
		)
		.run(submissionId);
	const attRes2 = sqlite
		.prepare(
			`INSERT INTO submission_attachments
				(submission_id, original_filename, stored_path, size_bytes, mime_type, sha256)
			 VALUES (?, 'b.pdf', '/x/b.pdf', 1, 'application/pdf', 'h2')`
		)
		.run(submissionId);
	const jobRes1 = sqlite
		.prepare(
			`INSERT INTO ocr_jobs (attachment_id, status, attempts, last_error)
			 VALUES (?, 'failed', 3, 'OcrProviderError')`
		)
		.run(Number(attRes1.lastInsertRowid));
	const jobRes2 = sqlite
		.prepare(
			`INSERT INTO ocr_jobs (attachment_id, status, attempts, last_error)
			 VALUES (?, 'failed', 3, 'OcrProviderError')`
		)
		.run(Number(attRes2.lastInsertRowid));
	sqlite.close();
	return {
		submissionId,
		jobIds: [Number(jobRes1.lastInsertRowid), Number(jobRes2.lastInsertRowid)]
	};
}

function setOcrHalted() {
	const sqlite = openDb();
	sqlite
		.prepare(
			`INSERT INTO system_state (key, value) VALUES ('ocr.halted', ?)
			 ON CONFLICT(key) DO UPDATE SET value=excluded.value`
		)
		.run(
			JSON.stringify({
				trippedAt: '2026-05-18T12:00:00.000Z',
				threshold: 4,
				jobIds: [],
				lastErrorClass: 'OcrProviderError'
			})
		);
	sqlite.close();
}

function clearOcrHalted() {
	const sqlite = openDb();
	sqlite.exec(`DELETE FROM system_state WHERE key='ocr.halted';`);
	sqlite.close();
}

function cleanupSeed(submissionId: number) {
	const sqlite = openDb();
	sqlite.prepare(`DELETE FROM submissions WHERE id = ?`).run(submissionId);
	sqlite.close();
}

test.describe.serial('/admin/queues pipeline dashboard', () => {
	test.afterEach(() => clearOcrHalted());

	test('non-admin (cfd_worker) is blocked from /admin/queues', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		const res = await page.goto('/admin/queues');
		expect(res?.status()).toBe(403);
	});

	test('admin sees both queue cards with status pills', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/admin/queues?bypass=admin@test');
		await expect(page.getByRole('heading', { name: 'Queue pipeline' })).toBeVisible();
		await expect(page.getByText('CHEFS ingestion', { exact: true })).toBeVisible();
		await expect(page.getByText('OCR queue', { exact: true })).toBeVisible();
		await expect(page.getByText('Last sync')).toBeVisible();
		await expect(page.getByText('Failure streak')).toBeVisible();
	});

	test('OCR halt banner renders and Resume queue clears the sentinel', async ({ page, context }) => {
		await context.clearCookies();
		setOcrHalted();
		await page.goto('/admin/queues?bypass=admin@test');
		await expect(page.getByText(/Halted at/).first()).toBeVisible();

		await page.getByRole('button', { name: /^Resume queue$/ }).click();
		// Confirmation dialog
		await page.getByRole('button', { name: /^Resume queue$/ }).nth(1).click();

		await expect(page.getByText(/OCR queue resumed\./i)).toBeVisible({ timeout: 5000 });
		const sqlite = openDb();
		const row = sqlite.prepare(`SELECT 1 FROM system_state WHERE key='ocr.halted'`).get();
		expect(row).toBeUndefined();
		sqlite.close();
	});

	test('Requeue all failed flips failed jobs back to queued and reports the count', async ({
		page,
		context
	}) => {
		await context.clearCookies();
		const { submissionId, jobIds } = seedFailedJobs();
		try {
			await page.goto('/admin/queues?bypass=admin@test');
			await expect(
				page.getByRole('button', { name: /Requeue all failed \(\d+\)/ })
			).toBeVisible();

			await page.getByRole('button', { name: /Requeue all failed \(\d+\)/ }).click();
			await page.getByRole('button', { name: /^Requeue all$/ }).click();

			await expect(page.getByText(/Requeued \d+ failed job\(s\)\./)).toBeVisible({
				timeout: 5000
			});

			const sqlite = openDb();
			const rows = sqlite
				.prepare(`SELECT id, status, requeue_count FROM ocr_jobs WHERE id IN (?, ?)`)
				.all(jobIds[0], jobIds[1]) as Array<{ id: number; status: string; requeue_count: number }>;
			sqlite.close();
			expect(rows).toHaveLength(2);
			for (const r of rows) {
				expect(r.status).toBe('queued');
				expect(r.requeue_count).toBeGreaterThanOrEqual(1);
			}
		} finally {
			cleanupSeed(submissionId);
		}
	});
});
