import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import type { SubmissionStatus } from '../db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export function recomputeSubmissionStatus(db: Db, submissionId: number): SubmissionStatus {
	const rows = db
		.select({ status: schema.ocrJobs.status })
		.from(schema.ocrJobs)
		.innerJoin(
			schema.submissionAttachments,
			eq(schema.submissionAttachments.id, schema.ocrJobs.attachmentId)
		)
		.where(eq(schema.submissionAttachments.submissionId, submissionId))
		.all();

	let next: SubmissionStatus;
	if (rows.length === 0) next = 'submitted';
	else if (rows.some((r) => r.status === 'failed' || r.status === 'abandoned')) next = 'OCR Error';
	else if (rows.every((r) => r.status === 'succeeded')) next = 'OCR processed';
	else next = 'OCR queued';

	db.update(schema.submissions)
		.set({ status: next, updatedAt: sql`CURRENT_TIMESTAMP` })
		.where(eq(schema.submissions.id, submissionId))
		.run();
	return next;
}
