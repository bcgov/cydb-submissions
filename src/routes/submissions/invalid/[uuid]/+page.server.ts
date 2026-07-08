import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invalidSubmissions } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');

	const rows = await db
		.select()
		.from(invalidSubmissions)
		.where(eq(invalidSubmissions.submissionUuid, params.uuid))
		.limit(1);

	const submission = rows[0];
	if (!submission) throw error(404, 'Invalid submission not found');

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
		}
	};
};

export const actions: Actions = {
	resolve: async ({ params, locals, url, request }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');

		const form = await request.formData();
		const note = (form.get('note') as string | null)?.trim() ?? '';
		if (!note) return fail(400, { error: 'A resolution note is required.' });

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
			locals.logger
		);
	}
};
