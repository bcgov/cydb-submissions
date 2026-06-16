import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export interface LeasedJob {
	id: number;
	attachmentId: number;
	attempts: number;
}

export function leaseNextJob(db: Db, workerId: string): LeasedJob | null {
	return db.transaction((tx) => {
		const candidate = tx
			.select({
				id: schema.ocrJobs.id,
				attachmentId: schema.ocrJobs.attachmentId,
				attempts: schema.ocrJobs.attempts
			})
			.from(schema.ocrJobs)
			.where(
				and(eq(schema.ocrJobs.status, 'queued'), lte(schema.ocrJobs.nextAttemptAt, sql`CURRENT_TIMESTAMP`))
			)
			.orderBy(asc(schema.ocrJobs.nextAttemptAt), asc(schema.ocrJobs.id))
			.limit(1)
			.get();
			console.log('leaseNextJob candidate: ', candidate);
		if (!candidate) return null;

		const updated = tx
			.update(schema.ocrJobs)
			.set({
				status: 'processing',
				leasedBy: workerId,
				leasedAt: sql`CURRENT_TIMESTAMP`,
				updatedAt: sql`CURRENT_TIMESTAMP`
			})
			.where(and(eq(schema.ocrJobs.id, candidate.id), eq(schema.ocrJobs.status, 'queued')))
			.run();
			console.log('leaseNextJob update: ', updated);
		if (updated.changes === 0) return null; // lost the race
		return { id: candidate.id, attachmentId: candidate.attachmentId, attempts: candidate.attempts };
	});
}

export interface ReleaseOpts {
	errorClass: string;
	nextAttemptAt: string;
}

export function releaseJob(db: Db, jobId: number, opts: ReleaseOpts): void {
	db.update(schema.ocrJobs)
		.set({
			status: 'queued',
			attempts: sql`${schema.ocrJobs.attempts} + 1`,
			lastError: opts.errorClass,
			nextAttemptAt: opts.nextAttemptAt,
			leasedBy: null,
			leasedAt: null,
			updatedAt: sql`CURRENT_TIMESTAMP`
		})
		.where(eq(schema.ocrJobs.id, jobId))
		.run();
}

export function markTerminal(
	db: Db,
	jobId: number,
	status: 'failed' | 'succeeded' | 'abandoned',
	errorClass?: string
): void {
	db.update(schema.ocrJobs)
		.set({
			status,
			attempts: status === 'succeeded' ? sql`${schema.ocrJobs.attempts}` : sql`${schema.ocrJobs.attempts} + 1`,
			lastError: errorClass ?? null,
			leasedBy: null,
			leasedAt: null,
			updatedAt: sql`CURRENT_TIMESTAMP`
		})
		.where(eq(schema.ocrJobs.id, jobId))
		.run();
}
