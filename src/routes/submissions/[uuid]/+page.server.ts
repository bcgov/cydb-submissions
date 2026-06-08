import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	submissions,
	submissionAttachments,
	submissionMetadata,
	ocrJobs,
	ocrResults
} from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import type { AttachmentOcr } from '$lib/types';

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

	return { submission, attachments, metadata: metaRows[0] ?? null };
};
