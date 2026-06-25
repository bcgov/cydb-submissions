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
	submissionClaims
} from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { CFD_WORKER_STATUSES } from '$lib/server/security/attachment-scope';
import type { AttachmentOcr } from '$lib/types';
import { listActiveReasons } from '$lib/server/reasons';
import { validateDecision, type DecisionOutcome } from '$lib/server/decision';
import { recordDecision, resetDecision } from '$lib/server/decision-store';
import { recomputeSubmissionStatus } from '$lib/server/ocr/status-transition';

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
	const rows = await db
		.select()
		.from(submissions)
		.where(eq(submissions.submissionUuid, params.uuid))
		.leftJoin(submissionClaims, eq(submissions.id, submissionClaims.submissionId))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'submission not found');

	const submission = row.submissions;

	if (!locals.roles.has('admin') && !CFD_WORKER_STATUSES.has(submission.status as never)) {
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
	const attIds = atts.map((a) => a.id);
	const [jobs, results] = await Promise.all([
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
			: Promise.resolve([])
	]);
	const jobByAtt = new Map(jobs.map((j) => [j.attachmentId, j]));
	const resByAtt = new Map(results.map((r) => [r.attachmentId, r]));

	const attachments = atts.map((a) => {
		const res = resByAtt.get(a.id);
		const job = jobByAtt.get(a.id);
		const ocr: AttachmentOcr = {
			status: res ? 'processed' : ((job?.status as AttachmentOcr['status']) ?? null),
			text: res?.rawText ?? null,
			pages: res?.pages ?? null,
			processedAt: res?.processedAt ?? null,
			error: job?.lastError ?? null
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
			decidedAt: submission.decidedAt,
			decidedByEmail
		},
		activeReasons,
		canDecide: locals.roles.has('admin') || locals.roles.has('cfd_worker'),
		isAdmin: locals.roles.has('admin'),
		claim: claimRow ? { email: claimEmail } : null,
		claimedByMe: claimRow?.userId === locals.user?.id
	};
};

export const actions: Actions = {
	claim: async ({ request, params, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
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
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
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

		const sub = (
			await db
				.select({ id: submissions.id, decision: submissions.decision })
				.from(submissions)
				.where(eq(submissions.submissionUuid, params.uuid))
				.limit(1)
		)[0];
		if (!sub) return fail(404, { action: 'decide', error: 'Submission not found.' });
		if (sub.decision)
			return fail(409, { action: 'decide', error: 'This submission has already been decided.' });

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
		const v = validateDecision({ decision, reasonIds }, active);
		if (!v.ok) {
			const msg =
				v.error === 'empty_reasons' ? 'Select at least one reason.' : 'Invalid reason selection.';
			return fail(400, { action: 'decide', error: msg });
		}
		const result = await recordDecision(db, {
			submissionId: sub.id,
			decision: v.decision,
			reasons: v.reasons,
			decidedBy: locals.user!.id
		});
		if (result === 'already_decided')
			return fail(409, { action: 'decide', error: 'This submission has already been decided.' });

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

	saveNotes: async ({ request, params, locals, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
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
