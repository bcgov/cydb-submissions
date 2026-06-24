import type { Role } from '../auth-types';
import type { SubmissionStatus } from '../db/schema';

export const CFD_WORKER_STATUSES = new Set<SubmissionStatus>([
	'submitted',
	'OCR queued',
	'OCR Error',
	'OCR processed',
	'ready for review',
	// Workers retain download access to submissions they have decided.
	'accepted',
	'rejected',
	'invalid'
]);

const CLINICIAN_STATUSES = new Set<SubmissionStatus>(['ready for clinician']);

export const WORKER_BLOCKED_STATUSES: SubmissionStatus[] = ['ready for clinician', 'reviewed'];

export function canAccessAttachmentByStatus(roles: Set<Role>, status: SubmissionStatus): boolean {
	if (roles.has('admin')) return true;
	if (roles.has('cfd_worker') && CFD_WORKER_STATUSES.has(status)) return true;
	if (roles.has('clinician') && CLINICIAN_STATUSES.has(status)) return true;
	return false;
}
