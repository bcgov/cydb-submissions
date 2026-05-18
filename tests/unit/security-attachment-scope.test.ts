import { describe, it, expect } from 'vitest';
import { canAccessAttachmentByStatus } from '$lib/server/security/attachment-scope';
import type { Role } from '$lib/server/auth-types';
import type { SubmissionStatus } from '$lib/server/db/schema';

const ALL_STATUSES: SubmissionStatus[] = [
	'submitted',
	'OCR queued',
	'OCR Error',
	'OCR processed',
	'ready for review',
	'ready for clinician',
	'reviewed',
	'invalid'
];

function rolesOf(...rs: Role[]): Set<Role> {
	return new Set(rs);
}

describe('canAccessAttachmentByStatus — per-status authorization (4.4)', () => {
	it('admin can access every status', () => {
		for (const s of ALL_STATUSES) {
			expect(canAccessAttachmentByStatus(rolesOf('admin'), s)).toBe(true);
		}
	});

	it("cfd_worker can access intake + processing statuses, but not 'ready for clinician' or 'reviewed'", () => {
		const allowed: SubmissionStatus[] = [
			'submitted',
			'OCR queued',
			'OCR Error',
			'OCR processed',
			'ready for review',
			'invalid'
		];
		const denied: SubmissionStatus[] = ['ready for clinician', 'reviewed'];
		for (const s of allowed) {
			expect(canAccessAttachmentByStatus(rolesOf('cfd_worker'), s)).toBe(true);
		}
		for (const s of denied) {
			expect(canAccessAttachmentByStatus(rolesOf('cfd_worker'), s)).toBe(false);
		}
	});

	it("clinician can ONLY access 'ready for clinician'", () => {
		expect(canAccessAttachmentByStatus(rolesOf('clinician'), 'ready for clinician')).toBe(true);
		for (const s of ALL_STATUSES.filter((s) => s !== 'ready for clinician')) {
			expect(canAccessAttachmentByStatus(rolesOf('clinician'), s)).toBe(false);
		}
	});

	it('multi-role users get the union of permissions', () => {
		// A user with both cfd_worker and clinician sees both intake AND clinician-status.
		const both = rolesOf('cfd_worker', 'clinician');
		expect(canAccessAttachmentByStatus(both, 'OCR queued')).toBe(true);
		expect(canAccessAttachmentByStatus(both, 'ready for clinician')).toBe(true);
		expect(canAccessAttachmentByStatus(both, 'reviewed')).toBe(false);
	});

	it('an empty role set denies everything', () => {
		for (const s of ALL_STATUSES) {
			expect(canAccessAttachmentByStatus(new Set(), s)).toBe(false);
		}
	});
});
