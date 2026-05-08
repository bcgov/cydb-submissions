import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { submissions, submissionAttachments, submissionMetadata } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
	const rows = await db
		.select()
		.from(submissions)
		.where(eq(submissions.submissionUuid, params.uuid))
		.limit(1);
	const submission = rows[0];
	if (!submission) throw error(404, 'submission not found');

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

	return { submission, attachments: atts, metadata: metaRows[0] ?? null };
};
