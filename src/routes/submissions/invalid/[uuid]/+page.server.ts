import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
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
			rawPayload
		}
	};
};
