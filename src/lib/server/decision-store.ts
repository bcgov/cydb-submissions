import { and, eq, isNull, sql } from 'drizzle-orm';
import { submissions } from './db/schema';
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
	await db
		.update(submissions)
		.set({
			decision: null,
			decisionReasons: null,
			decidedBy: null,
			decidedAt: null,
			status: 'ready for review'
		})
		.where(eq(submissions.id, submissionId));
}
