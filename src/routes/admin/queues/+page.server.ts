import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { getSystemState, clearSystemState } from '$lib/server/ocr/system-state';
import { redactForClient, getEffectiveConfig } from '$lib/server/chefs/config';
import { listSubmissions, downloadFile } from '$lib/server/chefs/client';
import { runOneSync } from '$lib/server/chefs/sync';
import type { SyncResult } from '$lib/server/chefs/types';
import { logger } from '$lib/server/log';

interface OcrHaltState {
	trippedAt: string;
	threshold: number;
	jobIds: number[];
	lastErrorClass: string | null;
}

interface ChefsHaltState {
	trippedAt: string;
	threshold: number;
	lastErrorClass: string | null;
}

export type OcrCount = { status: string; n: number };

export type RecentFailedJob = {
	id: number;
	attachmentId: number;
	attempts: number;
	requeueCount: number;
	lastError: string | null;
	updatedAt: string;
	status: string;
};

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');

	const ocrCounts: OcrCount[] = db
		.select({ status: schema.ocrJobs.status, n: sql<number>`count(*)` })
		.from(schema.ocrJobs)
		.groupBy(schema.ocrJobs.status)
		.all();

	const ocrHalted = getSystemState<OcrHaltState>(db, 'ocr.halted');

	const ocrRecentFailed: RecentFailedJob[] = db
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
		.limit(10)
		.all();

	const chefs = redactForClient(db, env as Record<string, string | undefined>);
	const chefsLastSync = getSystemState<SyncResult>(db, 'chefs.lastSync');
	const chefsFailureCount = getSystemState<number>(db, 'chefs.failureCount') ?? 0;
	const chefsHalted = getSystemState<ChefsHaltState>(db, 'chefs.halted');

	const workerEnabled = env.OCR_WORKER_ENABLED === '1';
	const provider = env.OCR_PROVIDER ?? 'stub';

	return {
		ocr: {
			workerEnabled,
			provider,
			counts: ocrCounts,
			halted: ocrHalted,
			recentFailed: ocrRecentFailed
		},
		chefs: {
			config: chefs,
			lastSync: chefsLastSync,
			failureCount: chefsFailureCount,
			halted: chefsHalted
		}
	};
};

export const actions: Actions = {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	chefsSyncNow: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'chefsSyncNow', error: 'CSRF token mismatch' });
		}
		const cfg = getEffectiveConfig(db, env as Record<string, string | undefined>);
		try {
			const res = await runOneSync(db, cfg, {
				list: (c) => listSubmissions(c, { fetch }),
				download: (fileId) => downloadFile(cfg, fileId, { fetch }, logger),
				attachmentsDir: env.ATTACHMENTS_DIR ?? './attachments',
				logger: locals.logger,
				actorUserId: locals.user!.id
			});
			return {
				action: 'chefsSyncNow',
				success: `Synced: fetched=${res.fetched}, ingested=${res.ingested}, invalid=${res.invalid}, skipped=${res.skippedDuplicate}.`
			};
		} catch (e) {
			return fail(500, { action: 'chefsSyncNow', error: (e as Error).message });
		}
	},

	chefsResume: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'chefsResume', error: 'CSRF token mismatch' });
		}
		clearSystemState(db, 'chefs.halted');
		clearSystemState(db, 'chefs.failureCount');
		auditLog(
			'queue_resumed',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: 'manual chefs resume via queue dashboard'
			},
			locals.logger
		);
		return { action: 'chefsResume', success: 'CHEFS poller resumed.' };
	},

	ocrResume: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'ocrResume', error: 'CSRF token mismatch' });
		}
		clearSystemState(db, 'ocr.halted');
		auditLog(
			'queue_resumed',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: 'manual ocr resume via queue dashboard'
			},
			locals.logger
		);
		return { action: 'ocrResume', success: 'OCR queue resumed.' };
	},

	ocrRequeueAllFailed: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'ocrRequeueAllFailed', error: 'CSRF token mismatch' });
		}
		const failedIds = db
			.select({ id: schema.ocrJobs.id })
			.from(schema.ocrJobs)
			.where(sql`${schema.ocrJobs.status} = 'failed'`)
			.all()
			.map((r) => r.id);
		if (failedIds.length === 0) {
			return { action: 'ocrRequeueAllFailed', success: 'No failed jobs to requeue.' };
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
			.where(sql`${schema.ocrJobs.status} = 'failed'`)
			.run();
		for (const jobId of failedIds) {
			auditLog(
				'ocr_job_requeued',
				{
					actorUserId: locals.user!.id,
					actorRole: 'admin',
					route: url.pathname,
					requestId: locals.requestId,
					jobId,
					reason: 'bulk requeue from queue dashboard'
				},
				locals.logger,
				db
			);
		}
		return {
			action: 'ocrRequeueAllFailed',
			success: `Requeued ${failedIds.length} failed job(s).`
		};
	}
};
