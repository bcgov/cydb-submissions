import type { Role } from '../auth-types';
import type { SubmissionStatus } from '../db/schema';

export const CFD_WORKER_STATUSES = new Set<SubmissionStatus>([
	'submitted',
	'OCR queued',
	'OCR Error',
	'OCR processed',
	'ready for review',
	'ready for clinician',
	'ready for policy',
	'provisionally eligible',
	// Workers retain download access to submissions they have decided.
	'accepted',
	'rejected',
	'invalid',
	'duplicate'
]);

const CLINICIAN_STATUSES = new Set<SubmissionStatus>(['ready for clinician']);
export const VALIDATOR_STATUSES = new Set<SubmissionStatus>(['ready for review']);

export const WORKER_BLOCKED_STATUSES: SubmissionStatus[] = ['reviewed'];

export function canAccessAttachmentByStatus(roles: Set<Role>, status: SubmissionStatus): boolean {
	if (roles.has('admin')) return true;
	if (roles.has('cfd_worker') && CFD_WORKER_STATUSES.has(status)) return true;
	if (roles.has('clinician') && CLINICIAN_STATUSES.has(status)) return true;
	if (roles.has('validator') && VALIDATOR_STATUSES.has(status)) return true;
	return false;
}
