import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { invalidSubmissions } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { getEffectiveConfig } from '$lib/server/chefs/config';
import { listSubmissions, downloadFile } from '$lib/server/chefs/client';
import { pickSubmissionUuid } from '$lib/server/chefs/mapper';
import { reingestOne } from '$lib/server/chefs/ingest';
import type { ChefsSubmissionRaw } from '$lib/server/chefs/types';

// Preserves the `from` query param (the list view's filters/pagination) when
// bouncing back to the main submissions page, mirroring the "Back to
// submissions" link's behaviour on the client.
function submissionsListUrl(url: URL): string {
	const from = url.searchParams.get('from');
	return from ? `/submissions${decodeURIComponent(from)}` : '/submissions';
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');

	const rows = await db
		.select()
		.from(invalidSubmissions)
		.where(eq(invalidSubmissions.submissionUuid, params.uuid))
		.limit(1);

	const submission = rows[0];
	if (!submission) throw error(404, 'Invalid submission not found');

	const chefsUuid = submission.submissionUuid.match(/chefs_([0-9\-a-zA-Z]{36})/);
	let chefsLink = undefined;

	if (chefsUuid && chefsUuid.length > 1) {
		const chefsConfig = getEffectiveConfig(db, env as Record<string, string | undefined>);
		chefsLink = chefsConfig.baseUrl + '/app/form/view?s=' + chefsUuid[1];
	}

	auditLog(
		'invalid_submission_viewed',
		{
			submissionUuid: submission.submissionUuid,
			actorUserId: locals.user!.id,
			actorRole: [...locals.roles][0],
			route: url.pathname,
			requestId: locals.requestId
		},
		locals.logger
	);

	let rawPayload: unknown = null;
	try {
		rawPayload = JSON.parse(submission.rawPayload);
	} catch {
		rawPayload = submission.rawPayload;
	}

	return {
		submission: {
			uuid: submission.submissionUuid,
			receivedAt: submission.receivedAt,
			ipAddress: submission.ipAddress,
			userAgent: submission.userAgent,
			validationErrors: submission.validationErrors as unknown[],
			rawPayload,
			resolvedAt: submission.resolvedAt,
			resolvedBy: submission.resolvedBy,
			resolvedNote: submission.resolvedNote
		},
		chefsLink,
		canReingest: Boolean(chefsLink)
	};
};

export const actions: Actions = {
	resolve: async ({ params, locals, url, request }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');

		const form = await request.formData();
		const note = (form.get('note') as string | null)?.trim() ?? '';
		if (!note) return fail(400, { action: 'resolve', error: 'A resolution note is required.' });

		const rows = await db
			.select({ id: invalidSubmissions.id, submissionUuid: invalidSubmissions.submissionUuid })
			.from(invalidSubmissions)
			.where(eq(invalidSubmissions.submissionUuid, params.uuid))
			.limit(1);

		const submission = rows[0];
		if (!submission) throw error(404, 'Invalid submission not found');

		await db
			.update(invalidSubmissions)
			.set({
				resolvedAt: new Date().toISOString(),
				resolvedBy: locals.user!.name,
				resolvedNote: note
			})
			.where(eq(invalidSubmissions.id, submission.id));

		auditLog(
			'invalid_submission_resolved',
			{
				submissionUuid: submission.submissionUuid,
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				requestId: locals.requestId,
				route: url.pathname
			},
			locals.logger,
			db
		);
	},

	// Re-fetches a CHEFS-sourced invalid submission from CHEFS and replaces it
	// — the old invalid-submission record is removed once the replacement
	// data is confirmed available (either a valid submission or a still-invalid one).
	reingest: async ({ params, locals, url }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');

		const rows = await db
			.select({ id: invalidSubmissions.id, submissionUuid: invalidSubmissions.submissionUuid })
			.from(invalidSubmissions)
			.where(eq(invalidSubmissions.submissionUuid, params.uuid))
			.limit(1);

		const submission = rows[0];
		if (!submission) return fail(404, { action: 'reingest', error: 'Invalid submission not found.' });

		const cfg = getEffectiveConfig(db, env as Record<string, string | undefined>);

		let rawList: unknown[];
		try {
			rawList = await listSubmissions(cfg, { fetch });
		} catch (e) {
			return fail(502, { action: 'reingest', error: `Failed to reach CHEFS: ${(e as Error).message}` });
		}

		const match = (rawList as ChefsSubmissionRaw[]).find((raw) => {
			try {
				return pickSubmissionUuid(raw) === submission.submissionUuid;
			} catch {
				return false;
			}
		});
		if (!match)
			return fail(404, {
				action: 'reingest',
				error: 'This submission could no longer be found in CHEFS.'
			});

		// reingestOne downloads the replacement attachments first and only
		// deletes/replaces the existing record once that succeeds, so a
		// network failure here leaves the original invalid submission untouched.
		let result;
		try {
			result = await reingestOne(
				db,
				cfg,
				match,
				{
					download: (fileId) => downloadFile(cfg, fileId, { fetch }, locals.logger),
					attachmentsDir: env.ATTACHMENTS_DIR ?? './attachments',
					logger: locals.logger
				},
				async () => {
					await db.delete(invalidSubmissions).where(eq(invalidSubmissions.id, submission.id));
				}
			);
		} catch (e) {
			auditLog(
				'submission_reingest_failed',
				{
					actorUserId: locals.user!.id,
					actorRole: [...locals.roles][0],
					submissionUuid: submission.submissionUuid,
					route: url.pathname,
					requestId: locals.requestId,
					reason: (e as Error).message
				},
				locals.logger
			);
			return fail(500, {
				action: 'reingest',
				error: `Reingestion failed, original submission was not modified: ${(e as Error).message}`
			});
		}

		auditLog(
			'submission_reingested',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				submissionUuid: submission.submissionUuid,
				route: url.pathname,
				requestId: locals.requestId,
				reason: `outcome=${result.outcome}`
			},
			locals.logger
		);

		// Land back on the main submissions list regardless of ingest outcome —
		// the original record no longer exists at this uuid.
		redirect(303, submissionsListUrl(url));
	}
};
