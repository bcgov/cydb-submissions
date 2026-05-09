import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { enqueueAttachments } from '$lib/server/ocr/enqueue';
import path from 'node:path';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('enqueueAttachments', () => {
	it('creates one ocr_jobs row per attachment id', () => {
		const sub = db
			.insert(schema.submissions)
			.values({
				submissionUuid: 't1',
				informationAccurate: true,
				dataSharingConsent: true,
				rawPayload: {}
			})
			.returning({ id: schema.submissions.id })
			.all();
		const attA = db
			.insert(schema.submissionAttachments)
			.values({
				submissionId: sub[0].id,
				originalFilename: 'a.pdf',
				storedPath: '/x/a.pdf',
				sizeBytes: 1,
				mimeType: 'application/pdf',
				sha256: 'h'
			})
			.returning({ id: schema.submissionAttachments.id })
			.all();
		const attB = db
			.insert(schema.submissionAttachments)
			.values({
				submissionId: sub[0].id,
				originalFilename: 'b.pdf',
				storedPath: '/x/b.pdf',
				sizeBytes: 1,
				mimeType: 'application/pdf',
				sha256: 'h'
			})
			.returning({ id: schema.submissionAttachments.id })
			.all();

		enqueueAttachments(db, [attA[0].id, attB[0].id]);

		const jobs = db.select().from(schema.ocrJobs).all();
		expect(jobs).toHaveLength(2);
		expect(jobs.every((j) => j.status === 'queued')).toBe(true);
	});

	it('is a no-op when given an empty list', () => {
		enqueueAttachments(db, []);
		expect(db.select().from(schema.ocrJobs).all()).toHaveLength(0);
	});
});
