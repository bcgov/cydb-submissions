import type { Logger } from 'pino';
import { AUDIT_EVENTS, type AuditEvent, type Role } from './auth-types';

const KNOWN = new Set<AuditEvent>(AUDIT_EVENTS);

export interface AuditPayload {
  submissionUuid?: string;
  attachmentId?: number;
  actorUserId?: string;
  actorRole?: Role;
  route: string;
  requestId: string;
  reason?: string;
}

export function auditLog(event: AuditEvent, payload: AuditPayload, logger: Logger) {
  if (!KNOWN.has(event)) throw new Error(`unknown audit event: ${event}`);
  logger.info({ event, ...payload }, 'audit');
}
