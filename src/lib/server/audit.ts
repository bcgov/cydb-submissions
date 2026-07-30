import type { Logger } from 'pino';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AUDIT_EVENTS, type AuditEvent, type Role } from './auth-types';
import type { DecisionOutcome } from './decision';
import * as schema from './db/schema';

const KNOWN = new Set<AuditEvent>(AUDIT_EVENTS);

const PERSISTED_EVENTS = new Set<AuditEvent>([
	'ocr_terminal_failed',
	'ocr_succeeded',
	'ocr_job_requeued',
	'submission_decided',
	'submission_decision_reset',
	'submission_ready_for_clinician',
	'submission_ready_for_clinician_reset',
	'invalid_submission_resolved',
	'submission_ready_for_validator',
	'submission_ready_for_validator_reset',
	'submission_ready_for_policy',
	'submission_provisionally_eligible',
	'submission_marked_duplicate',
	'submission_duplicate_reset'
]);

type AuditDb = BetterSQLite3Database<typeof schema>;

export interface AuditPayload {
	submissionUuid?: string;
	submissionId?: number;
	attachmentId?: number;
	decision?: DecisionOutcome;
	reasonId?: number;
	jobId?: number;
	actorUserId?: string;
	actorRole?: Role;
	targetUserId?: string;
	targetRole?: Role;
	route: string;
	requestId: string;
	reason?: string;
	errorClass?: string;
	newStatus?: string;
}

export function auditLog(event: AuditEvent, payload: AuditPayload, logger: Logger, db?: AuditDb) {
	if (!KNOWN.has(event)) throw new Error(`unknown audit event: ${event}`);
	logger.info({ event, ...payload }, 'audit');
	if (db && PERSISTED_EVENTS.has(event)) {
		try {
			db.insert(schema.auditLogs)
				.values({ event, ...payload })
				.run();
		} catch (err) {
			logger.error(
				{ event: 'audit_persist_failed', originalEvent: event, message: (err as Error).message },
				'failed to persist audit log'
			);
		}
	}
}
