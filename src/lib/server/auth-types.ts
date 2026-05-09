import { z } from 'zod';

export const ROLES = ['admin', 'cfd_worker', 'clinician'] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);

export const AUDIT_EVENTS = [
  'login_succeeded',
  'login_failed',
  'logout',
  'submission_listed',
  'submission_viewed',
  'attachment_downloaded',
  'role_denied',
  'auth_bypass_applied',
  'admin_seeded',
  'admin_cleared',
  'ocr_job_enqueued',
  'ocr_request_sent',
  'ocr_request_polled',
  'ocr_succeeded',
  'ocr_attempt_failed',
  'ocr_terminal_failed',
  'queue_halted',
  'queue_resumed',
  'ocr_job_requeued',
  'keyword_hits_recorded',
  'mail_logged'
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];
