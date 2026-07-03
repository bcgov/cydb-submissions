import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	submissions,
	submissionAttachments,
	submissionMetadata,
	ocrJobs,
	ocrResults,
	user,
	submissionClaims,
	keywordHits
} from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { CFD_WORKER_STATUSES } from '$lib/server/security/attachment-scope';
import type { AttachmentOcr } from '$lib/types';
import { listActiveAcceptReasons, listActiveReasons } from '$lib/server/reasons';
import { validateDecision, type DecisionOutcome } from '$lib/server/decision';
import { recordDecision, resetDecision } from '$lib/server/decision-store';
import { recomputeSubmissionStatus } from '$lib/server/ocr/status-transition';
import { getCategoryMapping } from '$lib/server/ocr/keywords';

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator', 'clinician');
	const categoryMap = await getCategoryMapping();
	const rows = await db
		.select()
		.from(submissions)
		.where(eq(submissions.submissionUuid, params.uuid))
		.leftJoin(submissionClaims, eq(submissions.id, submissionClaims.submissionId))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'submission not found');

	const submission = row.submissions;

	const isAdmin = locals.roles.has('admin');
	const isCfdWorker = locals.roles.has('cfd_worker');
	const isValidator = locals.roles.has('validator') && !isAdmin && !isCfdWorker;
	const isClinicianOnly = locals.roles.has('clinician') && !isAdmin && !isCfdWorker && !locals.roles.has('validator');

	if (isCfdWorker && !isAdmin && !CFD_WORKER_STATUSES.has(submission.status as never)) {
		throw error(403, 'Access denied');
	}
	if (isValidator && submission.status !== 'ready for review') {
		throw error(403, 'Access denied');
	}
	if (isClinicianOnly && submission.status !== 'ready for clinician') {
		throw error(403, 'Access denied');
	}
	const claimRow = row.submission_claims;

	const decidedByEmail = submission.decidedBy
		? ((
				await db
					.select({ email: user.email })
					.from(user)
					.where(eq(user.id, submission.decidedBy))
					.limit(1)
			)[0]?.email ?? submission.decidedBy)
		: null;

	let claimEmail: string | null = null;
	if (claimRow) {
		const [claimUser] = await db
			.select({ email: user.email })
			.from(user)
			.where(eq(user.id, claimRow.userId))
			.limit(1);
		claimEmail = claimUser?.email ?? null;
	}

	const activeReasons = await listActiveReasons(db);
	const activeAcceptReasons = await listActiveAcceptReasons(db);

	const [atts, metaRows] = await Promise.all([
		db
			.select()
			.from(submissionAttachments)
			.where(eq(submissionAttachments.submissionId, submission.id)),
		db
			.select()
			.from(submissionMetadata)
			.where(eq(submissionMetadata.submissionId, submission.id))
			.limit(1)
	]);

	// OCR state per attachment: extracted text (ocr_results) is the source of
	// truth for "processed"; otherwise fall back to the queue job's status.
	// Also grabs keyword hits
	const attIds = atts.map((a) => a.id);
	const [jobs, results, keywords] = await Promise.all([
		attIds.length
			? db
					.select({
						attachmentId: ocrJobs.attachmentId,
						status: ocrJobs.status,
						lastError: ocrJobs.lastError
					})
					.from(ocrJobs)
					.where(inArray(ocrJobs.attachmentId, attIds))
			: Promise.resolve([]),
		attIds.length
			? db
					.select({
						attachmentId: ocrResults.attachmentId,
						rawText: ocrResults.rawText,
						pages: ocrResults.pages,
						processedAt: ocrResults.processedAt
					})
					.from(ocrResults)
					.where(inArray(ocrResults.attachmentId, attIds))
			: Promise.resolve([]),
		attIds.length
			? db
					.select({
						attachmentId: keywordHits.attachmentId,
						keyword: keywordHits.keyword,
						category1: keywordHits.category1,
						category2: keywordHits.category2,
						category3: keywordHits.category3,
						category4: keywordHits.category4,
						category5: keywordHits.category5,
						category6: keywordHits.category6,
						category7: keywordHits.category7,
						category8: keywordHits.category8,
						category9: keywordHits.category9,
						category10: keywordHits.category10,
						category11: keywordHits.category11,
						category12: keywordHits.category12,
						category13: keywordHits.category13,
					})
					.from(keywordHits)
					.where(inArray(keywordHits.attachmentId, attIds))
			: Promise.resolve([])
	]);
	const jobByAtt = new Map(jobs.map((j) => [j.attachmentId, j]));
	const resByAtt = new Map(results.map((r) => [r.attachmentId, r]));

	const keywordsByAtt = new Map();

	for(const entry of keywords) {
		if (keywordsByAtt.get(entry.attachmentId) === undefined) {
			keywordsByAtt.set(entry.attachmentId, new Map<string, Array<string>>())
		}
		for (const [key, value] of Object.entries(entry)) {
			if (!key.startsWith('category')) continue;
			const attachmentIdEntry = keywordsByAtt.get(entry.attachmentId);
			if (attachmentIdEntry.get(key) === undefined) {
				attachmentIdEntry.set(key, new Array<string>())
			}
			if (value as number  > 0) {
				attachmentIdEntry.get(key).push(entry.keyword)
			}
		}
	}

	const attachments = atts.map((a) => {
		const res = resByAtt.get(a.id);
		const job = jobByAtt.get(a.id);
		const ocr: AttachmentOcr = {
			status: res ? 'processed' : ((job?.status as AttachmentOcr['status']) ?? null),
			text: res?.rawText ?? null,
			pages: res?.pages ?? null,
			processedAt: res?.processedAt ?? null,
			error: job?.lastError ?? null,
			keyword: keywordsByAtt.get(a.id) ?? new Map<string, Array<string>>(),
			categoryMap
		};
		return { ...a, ocr };
	});

	auditLog(
		'submission_viewed',
		{
			submissionUuid: submission.submissionUuid,
			actorUserId: locals.user!.id,
			actorRole: [...locals.roles][0],
			route: url.pathname,
			requestId: locals.requestId
		},
		locals.logger
	);

	return {
		submission,
		attachments,
		metadata: metaRows[0] ?? null,
		decision: {
			decision: submission.decision as 'accepted' | 'rejected' | null,
			reasons: (submission.decisionReasons ?? []) as string[],
			acceptTier: submission.acceptTier,
			decidedAt: submission.decidedAt,
			decidedByEmail
		},
		activeReasons,
		activeAcceptReasons,
		canDecide: locals.roles.has('admin') || locals.roles.has('cfd_worker'),
		canMarkForPolicy: locals.roles.has('admin') || locals.roles.has('cfd_worker') || locals.roles.has('validator') || locals.roles.has('clinician'),
		isAdmin: locals.roles.has('admin'),
		isCfdWorker: isCfdWorker && !isAdmin,
		claim: claimRow ? { email: claimEmail } : null,
		claimedByMe: claimRow?.userId === locals.user?.id,
	};
};

export const actions: Actions = {
	claim: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator', 'clinician');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'claim', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'claim', error: 'Submission not found.' });

		const existing = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];

		if (existing) {
			if (existing.userId !== locals.user!.id)
				return fail(409, {
					action: 'claim',
					error: 'This submission is already claimed by another user.'
				});
			return { action: 'claim', success: 'Submission already claimed.' };
		}

		await db.insert(submissionClaims).values({ submissionId: sub.id, userId: locals.user!.id });

		auditLog(
			'submission_claimed',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'claim', success: 'Submission claimed.' };
	},

	unclaim: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator', 'clinician');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'unclaim', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'unclaim', error: 'Submission not found.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim) return fail(400, { action: 'unclaim', error: 'Submission is not claimed.' });
		if (claim.userId !== locals.user!.id && !locals.roles.has('admin'))
			return fail(403, {
				action: 'unclaim',
				error: 'Only the claiming user or an admin can unclaim.'
			});

		await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));

		auditLog(
			'submission_unclaimed',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'unclaim', success: 'Claim released.' };
	},

	decide: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'decide', error: 'CSRF token mismatch' });

		const decision = String(form.get('decision') ?? '');
		if (decision !== 'accepted' && decision !== 'rejected')
			return fail(400, { action: 'decide', error: 'Choose accept or reject.' });
		const reasonIds = form
			.getAll('reasonIds')
			.map((v) => Number(v))
			.filter((n) => Number.isInteger(n) && n > 0);
		const tierChoice = form.get('tier') ? form.get('tier') as string : null;

		const sub = (
			await db
				.select({ id: submissions.id, decision: submissions.decision, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'decide', error: 'Submission not found.' });
		if (sub.status !== 'provisionally eligible' && sub.status !== 'ready for policy')
			return fail(400, { action: 'decide', error: 'Decisions can only be recorded for submissions in provisionally eligible or ready for policy status.' });
		if (sub.status === 'ready for policy' && decision === 'accepted')
			return fail(400, { action: 'decide', error: 'Only reject is permitted for submissions in ready for policy status.' });
		if (sub.decision)
			return fail(409, { action: 'decide', error: 'This submission has already been decided.' });
		if (sub.status !== 'provisionally eligible' && sub.status !== 'ready for policy')
			return fail(400, { action: 'decide', error: 'Submission is not in a decidable status.' });
		if (sub.status === 'ready for policy' && decision === 'accepted')
			return fail(400, { action: 'decide', error: 'Cannot accept a submission in ready for policy status.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, { action: 'decide', error: 'You must claim this submission before recording a decision.' });

		const active = await listActiveReasons(db);
		const activeAccept = await listActiveAcceptReasons(db);
		const v = validateDecision({ decision, reasonIds }, active, activeAccept, tierChoice);
		if (!v.ok) {
			const msg =
				v.error === 'empty_reasons' ? 'Select at least one reason.' : 'Invalid reason selection.';
			return fail(400, { action: 'decide', error: msg });
		}
		const result = await recordDecision(db, {
			submissionId: sub.id,
			decision: v.decision,
			reasons: v.reasons,
			tierChoice: tierChoice,
			decidedBy: locals.user!.id
		});
		if (result === 'already_decided')
			return fail(409, { action: 'decide', error: 'This submission has already been decided.' });
    await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));
    
		auditLog(
			'submission_decided',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				decision: v.decision,
				reason: v.reasons.length ? `${v.reasons.length} reason(s)` : undefined,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'decide', success: `Decision recorded: ${v.decision}.` };
	},

	resetDecision: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'reset', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, decision: submissions.decision })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'reset', error: 'Submission not found.' });
		if (!sub.decision) return fail(400, { action: 'reset', error: 'No decision to reset.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, { action: 'reset', error: 'You must claim this submission before resetting a decision.' });

		await resetDecision(db, sub.id);
		auditLog(
			'submission_decision_reset',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				decision: sub.decision as DecisionOutcome,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'reset', success: 'Decision reset — submission returned to review.' };
	},

	readyForClinician: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'readyForClinician', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'readyForClinician', error: 'Submission not found.' });
		if (!['OCR processed', 'OCR Error'].includes(sub.status))
			return fail(400, { action: 'readyForClinician', error: 'Submission is not in OCR processed or OCR error status.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'readyForClinician',
				error: 'You must claim this submission to perform this action.'
			});

		await db
			.update(submissions)
			.set({ status: 'ready for clinician' })
			.where(eq(submissions.id, sub.id));
		await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));

		auditLog(
			'submission_ready_for_clinician',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		if (!locals.roles.has('admin')) redirect(303, '/submissions');
		return { action: 'readyForClinician', success: 'Submission marked as ready for clinician.' };
	},

	resetReadyForClinician: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'resetReadyForClinician', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'resetReadyForClinician', error: 'Submission not found.' });
		if (sub.status !== 'ready for clinician')
			return fail(400, {
				action: 'resetReadyForClinician',
				error: 'Submission is not in ready for clinician status.'
			});

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'resetReadyForClinician',
				error: 'You must claim this submission before resetting its status.'
			});

		const newStatus = recomputeSubmissionStatus(db, sub.id);

		auditLog(
			'submission_ready_for_clinician_reset',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				newStatus,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'resetReadyForClinician', success: `Status reset to: ${newStatus}.` };
	},

	readyForValidator: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'readyForValidator', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'readyForValidator', error: 'Submission not found.' });
		if (!['OCR processed', 'OCR Error'].includes(sub.status))
			return fail(400, { action: 'readyForValidator', error: 'Submission is not in OCR processed or OCR error status.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'readyForValidator',
				error: 'You must claim this submission to perform this action.'
			});

		await db
			.update(submissions)
			.set({ status: 'ready for review' })
			.where(eq(submissions.id, sub.id));
		await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));

		auditLog(
			'submission_ready_for_validator',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		if (!locals.roles.has('admin')) redirect(303, '/submissions');
		return { action: 'readyForValidator', success: 'Submission marked as ready for validator.' };
	},

	resetReadyForValidator: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'resetReadyForValidator', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'resetReadyForValidator', error: 'Submission not found.' });
		if (sub.status !== 'ready for review')
			return fail(400, {
				action: 'resetReadyForValidator',
				error: 'Submission is not in ready for review status.'
			});

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'resetReadyForValidator',
				error: 'You must claim this submission before resetting its status.'
			});

		const newStatus = recomputeSubmissionStatus(db, sub.id);

		auditLog(
			'submission_ready_for_validator_reset',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				newStatus,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'resetReadyForValidator', success: `Status reset to: ${newStatus}.` };
	},

	readyForPolicy: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator', 'clinician');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'readyForPolicy', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'readyForPolicy', error: 'Submission not found.' });

		const ALLOWED_STATUSES = ['ready for review', 'ready for clinician'] as const;
		if (!ALLOWED_STATUSES.includes(sub.status as never))
			return fail(400, {
				action: 'readyForPolicy',
				error: 'Submission must be in ready for review or ready for clinician status to perform this action.'
			});

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'readyForPolicy',
				error: 'You must claim this submission to perform this action.'
			});

		await db
			.update(submissions)
			.set({ status: 'ready for policy' })
			.where(eq(submissions.id, sub.id));
		await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));

		auditLog(
			'submission_ready_for_policy',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		if (!locals.roles.has('admin') && !locals.roles.has('cfd_worker')) redirect(303, '/submissions');
		return { action: 'readyForPolicy', success: 'Submission marked as ready for policy.' };
	},

	provisionallyEligible: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'provisionallyEligible', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'provisionallyEligible', error: 'Submission not found.' });
		if (sub.status !== 'ready for review' && sub.status !== 'ready for policy')
			return fail(400, {
				action: 'provisionallyEligible',
				error: 'Submission must be in ready for review or ready for policy status to perform this action.'
			});

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'provisionallyEligible',
				error: 'You must claim this submission to perform this action.'
			});

		await db
			.update(submissions)
			.set({ status: 'provisionally eligible' })
			.where(eq(submissions.id, sub.id));
		await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));

		auditLog(
			'submission_provisionally_eligible',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		if (!locals.roles.has('admin') && !locals.roles.has('cfd_worker')) redirect(303, '/submissions');
		return { action: 'provisionallyEligible', success: 'Submission marked as provisionally eligible.' };
	},

	markDuplicate: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator', 'clinician');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'markDuplicate', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'markDuplicate', error: 'Submission not found.' });

		const ALLOWED_STATUSES = [
			'submitted', 'OCR queued', 'OCR processed', 'OCR Error',
			'ready for review', 'ready for clinician', 'ready for policy', 'provisionally eligible'
		] as const;
		if (!ALLOWED_STATUSES.includes(sub.status as never))
			return fail(400, { action: 'markDuplicate', error: 'Submission cannot be marked as duplicate from its current status.' });

		await db.update(submissions).set({ status: 'duplicate' }).where(eq(submissions.id, sub.id));
		await db.delete(submissionClaims).where(eq(submissionClaims.submissionId, sub.id));

		auditLog(
			'submission_marked_duplicate',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		if (!locals.roles.has('admin') && !locals.roles.has('cfd_worker')) redirect(303, '/submissions');
		return { action: 'markDuplicate', success: 'Submission marked as duplicate.' };
	},

	resetDuplicate: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'resetDuplicate', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id, status: submissions.status })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'resetDuplicate', error: 'Submission not found.' });
		if (sub.status !== 'duplicate')
			return fail(400, { action: 'resetDuplicate', error: 'Submission is not in duplicate status.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, { action: 'resetDuplicate', error: 'You must claim this submission before resetting its status.' });

		const newStatus = recomputeSubmissionStatus(db, sub.id);

		auditLog(
			'submission_duplicate_reset',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: params.uuid,
				submissionId: sub.id,
				newStatus,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'resetDuplicate', success: `Status reset to: ${newStatus}.` };
	},

	saveNotes: async ({ request, params, locals, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker', 'validator', 'clinician');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'saveNotes', error: 'CSRF token mismatch' });

		const sub = (
			await db
				.select({ id: submissions.id })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'saveNotes', error: 'Submission not found.' });

		const claim = (
			await db
				.select()
				.from(submissionClaims)
				.where(eq(submissionClaims.submissionId, sub.id))
				.limit(1)
		)[0];
		if (!claim || claim.userId !== locals.user!.id)
			return fail(403, {
				action: 'saveNotes',
				error: 'You must claim this submission before saving notes.'
			});

		const notes = form.get('notes');
		await db
			.update(submissions)
			.set({ levelOfNeedSummary: notes ? String(notes) : null })
			.where(eq(submissions.id, sub.id));

		return { action: 'saveNotes', success: 'Notes saved.' };
	}
};
