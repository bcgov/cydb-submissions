import type { Role } from '../auth-types';
import type { SubmissionStatus } from '../db/schema';

const CFD_WORKER_STATUSES = new Set<SubmissionStatus>([
	'submitted',
	'OCR queued',
	'OCR Error',
	'OCR processed',
	'ready for review',
	'invalid'
]);

const CLINICIAN_STATUSES = new Set<SubmissionStatus>(['ready for clinician']);

export function canAccessAttachmentByStatus(
	roles: Set<Role>,
	status: SubmissionStatus
): boolean {
	if (roles.has('admin')) return true;
	if (roles.has('cfd_worker') && CFD_WORKER_STATUSES.has(status)) return true;
	if (roles.has('clinician') && CLINICIAN_STATUSES.has(status)) return true;
	return false;
}
