import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { recomputeSubmissionStatus } from '$lib/server/ocr/status-transition';
import { insertValidSubmission } from '../helpers/insert-valid-submission';
import { eq } from 'drizzle-orm';
import path from 'node:path';

let db: ReturnType<typeof drizzle<typeof schema>>;

function seedSub(): number {
	return insertValidSubmission(db);
}

function seedAttachmentWithJob(submissionId: number, jobStatus: string): number {
	const att = db
		.insert(schema.submissionAttachments)
		.values({
			submissionId,
			originalFilename: 'x.pdf',
			storedPath: '/x',
			sizeBytes: 1,
			mimeType: 'application/pdf',
			sha256: 'h'
		})
		.returning({ id: schema.submissionAttachments.id })
		.all();
	db.insert(schema.ocrJobs)
		.values({
			attachmentId: att[0].id,
			status: jobStatus as 'queued' | 'processing' | 'succeeded' | 'failed' | 'abandoned'
		})
		.run();
	return att[0].id;
}

function statusOf(id: number): string {
	return db
		.select({ s: schema.submissions.status })
		.from(schema.submissions)
		.where(eq(schema.submissions.id, id))
		.get()!.s;
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('recomputeSubmissionStatus', () => {
	it('with 0 attachments leaves status at submitted', () => {
		const id = seedSub();
		recomputeSubmissionStatus(db, id);
		expect(statusOf(id)).toBe('submitted');
	});
	it('all jobs queued → OCR queued', () => {
		const id = seedSub();
		seedAttachmentWithJob(id, 'queued');
		seedAttachmentWithJob(id, 'queued');
		recomputeSubmissionStatus(db, id);
		expect(statusOf(id)).toBe('OCR queued');
	});
	it('all jobs succeeded → OCR processed', () => {
		const id = seedSub();
		seedAttachmentWithJob(id, 'succeeded');
		recomputeSubmissionStatus(db, id);
		expect(statusOf(id)).toBe('OCR processed');
	});
	it('any failed job → OCR Error', () => {
		const id = seedSub();
		seedAttachmentWithJob(id, 'succeeded');
		seedAttachmentWithJob(id, 'failed');
		recomputeSubmissionStatus(db, id);
		expect(statusOf(id)).toBe('OCR Error');
	});
	it('mix of queued and succeeded → OCR queued', () => {
		const id = seedSub();
		seedAttachmentWithJob(id, 'queued');
		seedAttachmentWithJob(id, 'succeeded');
		recomputeSubmissionStatus(db, id);
		expect(statusOf(id)).toBe('OCR queued');
	});
	it('abandoned job counts as OCR Error', () => {
		const id = seedSub();
		seedAttachmentWithJob(id, 'abandoned');
		recomputeSubmissionStatus(db, id);
		expect(statusOf(id)).toBe('OCR Error');
	});
});
