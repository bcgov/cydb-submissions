import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { ingestOne } from '$lib/server/chefs/ingest';
import type { ChefsConfig } from '$lib/server/chefs/types';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Load the canonical fixture once; tests may spread-override specific fields.
const yesFixture = require(path.resolve('tests/fixtures/chefs-submission-yes.json'));

const cfg: ChefsConfig = {
	formId: 'f',
	apiToken: 't',
	version: '0',
	baseUrl: 'https://chefs.test',
	fileComponents: ['AttachAssessment'],
	apiParams: {},
	pollerEnabled: false,
	pollIntervalMs: 60_000
};

// A stable UUID derived from the yes-fixture for assertions.
const FIXTURE_UUID = `chefs_${yesFixture.form.submissionId}`;

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: InstanceType<typeof Database>;
let attachmentsDir: string;

beforeEach(() => {
	sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
	attachmentsDir = mkdtempSync(path.join(os.tmpdir(), 'cydb-chefs-'));
});

describe('ingestOne', () => {
	it('downloads files, writes the submission, and enqueues an OCR job', async () => {
		const download = vi.fn().mockResolvedValue({
			bytes: Buffer.from('pdf-bytes'),
			mimeType: 'application/pdf'
		});
		const res = await ingestOne(db, cfg, yesFixture, {
			download,
			attachmentsDir,
			logger: stubLogger()
		});
		expect(res.outcome).toBe('ingested');
		expect(res.submissionUuid).toBe(FIXTURE_UUID);

		const subs = db.select().from(schema.submissions).all();
		expect(subs).toHaveLength(1);
		expect(subs[0].submissionUuid).toBe(FIXTURE_UUID);

		const atts = db.select().from(schema.submissionAttachments).all();
		expect(atts).toHaveLength(2); // fixture has 2 editGrid rows, each with one file
		expect(atts.some((a) => a.originalFilename === 'diagnosis.pdf')).toBe(true);
		expect(atts.every((a) => existsSync(a.storedPath))).toBe(true);

		const jobs = db.select().from(schema.ocrJobs).all();
		expect(jobs).toHaveLength(2);
		expect(jobs.every((j) => j.status === 'queued')).toBe(true);
	});

	it('skips when the submission_uuid already exists', async () => {
		const download = vi
			.fn()
			.mockResolvedValue({ bytes: Buffer.from('pdf-bytes'), mimeType: 'application/pdf' });
		await ingestOne(db, cfg, yesFixture, { download, attachmentsDir, logger: stubLogger() });
		const second = await ingestOne(db, cfg, yesFixture, {
			download,
			attachmentsDir,
			logger: stubLogger()
		});
		expect(second.outcome).toBe('skipped');
		expect(db.select().from(schema.submissions).all()).toHaveLength(1);
	});

	it('skips when the submission_uuid already exists in invalid_submissions', async () => {
		db.insert(schema.invalidSubmissions)
			.values({
				submissionUuid: FIXTURE_UUID,
				rawPayload: '{}',
				validationErrors: []
			})
			.run();
		const download = vi.fn();
		const res = await ingestOne(db, cfg, yesFixture, {
			download,
			attachmentsDir,
			logger: stubLogger()
		});
		expect(res.outcome).toBe('skipped');
		expect(download).not.toHaveBeenCalled();
	});

	it('writes to invalid_submissions when validation fails', async () => {
		// Missing PrimaryCareAndControl makes the submission invalid.
		const bad = { ...yesFixture, PrimaryCareAndControl: { Yes: false } };
		const download = vi.fn();
		const res = await ingestOne(db, cfg, bad, { download, attachmentsDir, logger: stubLogger() });
		expect(res.outcome).toBe('invalid');
		expect(download).not.toHaveBeenCalled();
		const invalid = db.select().from(schema.invalidSubmissions).all();
		expect(invalid).toHaveLength(1);
		expect(invalid[0].submissionUuid).toBe(FIXTURE_UUID);
	});

	it('strips path components from attachment filenames before writing', async () => {
		const malicious = {
			...yesFixture,
			form: { submissionId: 'sub-uuid-MAL', confirmationId: 'MAL' },
			editGrid: [
				{
					...yesFixture.editGrid[0],
					AttachAssessment: [{ originalName: '../../escape.pdf', data: { id: 'file-MAL' } }]
				}
			]
		};
		const download = vi.fn().mockResolvedValue({
			bytes: Buffer.from('payload'),
			mimeType: 'application/pdf'
		});
		await ingestOne(db, cfg, malicious, { download, attachmentsDir, logger: stubLogger() });
		const atts = db.select().from(schema.submissionAttachments).all();
		expect(atts).toHaveLength(1);
		// stored path must remain inside attachmentsDir/{submissionUuid}/
		const expectedDir = path.join(attachmentsDir, 'chefs_sub-uuid-MAL');
		expect(atts[0].storedPath).toBe(path.join(expectedDir, 'escape.pdf'));
		expect(atts[0].storedPath.startsWith(expectedDir + path.sep)).toBe(true);
	});

	it('persists assessment_index from editGrid-nested files', async () => {
		const download = vi.fn().mockResolvedValue({
			bytes: Buffer.from('pdf-bytes'),
			mimeType: 'application/pdf'
		});
		const res = await ingestOne(db, cfg, yesFixture, {
			download,
			attachmentsDir,
			logger: stubLogger()
		});
		expect(res.outcome).toBe('ingested');

		const rows = sqlite
			.prepare(
				'SELECT original_filename AS f, assessment_index AS i FROM submission_attachments ORDER BY assessment_index'
			)
			.all() as Array<{ f: string; i: number }>;
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.i)).toEqual([0, 1]);
		expect(rows[0].f).toBe('diagnosis.pdf');
		expect(rows[1].f).toBe('slp.pdf');
	});
});

function stubLogger() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => stubLogger() } as any;
}
