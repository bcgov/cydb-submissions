import { and, eq, isNull, sql } from 'drizzle-orm';
import { ocrJobs, submissionAttachments, submissions, type SubmissionStatus } from './db/schema';
import type { DrizzleDb } from './roles';
import type { DecisionOutcome } from './decision';

/** Write-once: only sets the decision when none exists yet (atomic via the WHERE). */
export async function recordDecision(
	db: DrizzleDb,
	args: { submissionId: number; decision: DecisionOutcome; reasons: string[]; decidedBy: string }
): Promise<'ok' | 'already_decided'> {
	const res = await db
		.update(submissions)
		.set({
			decision: args.decision,
			decisionReasons: args.reasons,
			decidedBy: args.decidedBy,
			decidedAt: sql`CURRENT_TIMESTAMP`,
			status: args.decision
		})
		.where(and(eq(submissions.id, args.submissionId), isNull(submissions.decision)))
		.returning({ id: submissions.id });
	return res.length > 0 ? 'ok' : 'already_decided';
}

export async function resetDecision(db: DrizzleDb, submissionId: number): Promise<void> {
	// This is the same log used to update OCR status. It is copied in to prevent the db update from occurring twice.
	const rows = db
		.select({ status: ocrJobs.status })
		.from(ocrJobs)
		.innerJoin(
			submissionAttachments,
			eq(submissionAttachments.id, ocrJobs.attachmentId)
		)
		.where(eq(submissionAttachments.submissionId, submissionId))
		.all();
	
	let next: SubmissionStatus;
	if (rows.length === 0) next = 'submitted';
	else if (rows.some((r) => r.status === 'failed' || r.status === 'abandoned')) next = 'OCR Error';
	else if (rows.every((r) => r.status === 'succeeded')) next = 'OCR processed';
	else next = 'OCR queued';

	await db
		.update(submissions)
		.set({
			decision: null,
			decisionReasons: null,
			decidedBy: null,
			decidedAt: null,
			status: next
		})
		.where(eq(submissions.id, submissionId));
}
