import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { leaseNextJob, releaseJob, markTerminal } from '$lib/server/ocr/lease';
import { insertValidSubmission } from '../helpers/insert-valid-submission';
import { eq } from 'drizzle-orm';
import path from 'node:path';

let db: ReturnType<typeof drizzle<typeof schema>>;

function seedJob(nextAt = new Date(0).toISOString()): number {
	const subId = insertValidSubmission(db);
	const sub = [{ id: subId }];
	const att = db
		.insert(schema.submissionAttachments)
		.values({
			submissionId: sub[0].id,
			originalFilename: 'x.pdf',
			storedPath: '/x',
			sizeBytes: 1,
			mimeType: 'application/pdf',
			sha256: 'h'
		})
		.returning({ id: schema.submissionAttachments.id })
		.all();
	const job = db
		.insert(schema.ocrJobs)
		.values({ attachmentId: att[0].id, status: 'queued', nextAttemptAt: nextAt })
		.returning({ id: schema.ocrJobs.id })
		.all();
	return job[0].id;
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('leaseNextJob', () => {
	it('returns null when nothing is queued', () => {
		expect(leaseNextJob(db, 'worker-1')).toBeNull();
	});

	it('flips a queued job to processing and stamps leased_by/leased_at', () => {
		const jobId = seedJob();
		const leased = leaseNextJob(db, 'worker-1');
		expect(leased?.id).toBe(jobId);
		const row = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, jobId)).get()!;
		expect(row.status).toBe('processing');
		expect(row.leasedBy).toBe('worker-1');
		expect(row.leasedAt).not.toBeNull();
	});

	it('does not lease a job whose nextAttemptAt is in the future', () => {
		const future = new Date(Date.now() + 60_000).toISOString();
		seedJob(future);
		expect(leaseNextJob(db, 'worker-1')).toBeNull();
	});

	it('a second worker leases a different job (FIFO oldest first)', () => {
		seedJob('2020-01-01T00:00:00Z');
		seedJob('2020-01-01T00:00:01Z');
		const a = leaseNextJob(db, 'worker-A');
		const b = leaseNextJob(db, 'worker-B');
		expect(a!.id).not.toBe(b!.id);
	});

	it('releaseJob returns it to queued with bumped attempts and a future nextAttemptAt', () => {
		const id = seedJob();
		const leased = leaseNextJob(db, 'worker-1')!;
		releaseJob(db, leased.id, {
			errorClass: 'OcrProviderError',
			nextAttemptAt: new Date(Date.now() + 1000).toISOString()
		});
		const row = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, id)).get()!;
		expect(row.status).toBe('queued');
		expect(row.attempts).toBe(1);
		expect(row.lastError).toBe('OcrProviderError');
		expect(row.leasedBy).toBeNull();
	});

	it('markTerminal records succeeded without bumping attempts', () => {
		const id = seedJob();
		const leased = leaseNextJob(db, 'worker-1')!;
		markTerminal(db, leased.id, 'succeeded');
		const row = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, id)).get()!;
		expect(row.status).toBe('succeeded');
		expect(row.attempts).toBe(0);
	});

	it('markTerminal records failed with error class', () => {
		const id = seedJob();
		leaseNextJob(db, 'worker-1');
		markTerminal(db, id, 'failed', 'OcrTerminalError');
		const row = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, id)).get()!;
		expect(row.status).toBe('failed');
		expect(row.lastError).toBe('OcrTerminalError');
	});
});
