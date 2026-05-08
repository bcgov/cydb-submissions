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
  'admin_cleared'
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];
