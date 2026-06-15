import type { Logger } from 'pino';
import { AUDIT_EVENTS, type AuditEvent, type Role } from './auth-types';
import type { DecisionOutcome } from './decision';

const KNOWN = new Set<AuditEvent>(AUDIT_EVENTS);

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
}

export function auditLog(event: AuditEvent, payload: AuditPayload, logger: Logger) {
	if (!KNOWN.has(event)) throw new Error(`unknown audit event: ${event}`);
	logger.info({ event, ...payload }, 'audit');
}
