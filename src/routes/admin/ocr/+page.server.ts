import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { getSystemState, clearSystemState } from '$lib/server/ocr/system-state';
import { sql, eq } from 'drizzle-orm';

interface HaltState {
	trippedAt: string;
	threshold: number;
	jobIds: number[];
	lastErrorClass: string | null;
}

const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');

	const counts = db
		.select({ status: schema.ocrJobs.status, n: sql<number>`count(*)` })
		.from(schema.ocrJobs)
		.groupBy(schema.ocrJobs.status)
		.all();

	const halted = getSystemState<HaltState>(db, 'ocr.halted');

	const failedPage = Math.max(1, parseInt(url.searchParams.get('failedPage') ?? '1', 10) || 1);

	const totalFailed = (
		db
			.select({ n: sql<number>`count(*)` })
			.from(schema.ocrJobs)
			.where(sql`${schema.ocrJobs.status} IN ('failed','abandoned')`)
			.get() as { n: number }
	).n;

	const recentFailed = db
		.select({
			id: schema.ocrJobs.id,
			attachmentId: schema.ocrJobs.attachmentId,
			attempts: schema.ocrJobs.attempts,
			requeueCount: schema.ocrJobs.requeueCount,
			lastError: schema.ocrJobs.lastError,
			updatedAt: schema.ocrJobs.updatedAt,
			status: schema.ocrJobs.status
		})
		.from(schema.ocrJobs)
		.where(sql`${schema.ocrJobs.status} IN ('failed','abandoned')`)
		.orderBy(sql`${schema.ocrJobs.updatedAt} DESC`)
		.limit(PAGE_SIZE)
		.offset((failedPage - 1) * PAGE_SIZE)
		.all();

	return { counts, halted, recentFailed, failedPage, totalFailed, failedPageSize: PAGE_SIZE };
};

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const actions: Actions = {
	resume: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'resume', error: 'CSRF token mismatch' });
		}
		clearSystemState(db, 'ocr.halted');
		auditLog(
			'queue_resumed',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'resume', success: 'Queue resumed.' };
	},

	requeue: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'requeue', error: 'CSRF token mismatch' });
		}
		const jobId = Number(form.get('jobId'));
		if (!Number.isInteger(jobId)) {
			return fail(400, { action: 'requeue', error: 'invalid jobId' });
		}
		db.update(schema.ocrJobs)
			.set({
				status: 'queued',
				attempts: 0,
				requeueCount: sql`${schema.ocrJobs.requeueCount} + 1`,
				lastError: null,
				nextAttemptAt: sql`CURRENT_TIMESTAMP`,
				leasedBy: null,
				leasedAt: null,
				updatedAt: sql`CURRENT_TIMESTAMP`
			})
			.where(eq(schema.ocrJobs.id, jobId))
			.run();
		auditLog(
			'ocr_job_requeued',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				jobId
			},
			locals.logger
		);
		return { action: 'requeue', success: `Job ${jobId} requeued.` };
	},

	abandon: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'abandon', error: 'CSRF token mismatch' });
		}
		const jobId = Number(form.get('jobId'));
		if (!Number.isInteger(jobId)) {
			return fail(400, { action: 'abandon', error: 'invalid jobId' });
		}
		db.update(schema.ocrJobs)
			.set({
				status: 'abandoned',
				lastError: 'AbandonedByAdmin',
				updatedAt: sql`CURRENT_TIMESTAMP`
			})
			.where(eq(schema.ocrJobs.id, jobId))
			.run();
		auditLog(
			'ocr_terminal_failed',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				jobId,
				reason: 'AbandonedByAdmin'
			},
			locals.logger
		);
		return { action: 'abandon', success: `Job ${jobId} abandoned.` };
	}
};
