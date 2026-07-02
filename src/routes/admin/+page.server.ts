import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { seedMockSubmissions, clearAllSubmissions } from '$lib/server/admin-seed';
import { getEffectiveConfig } from '$lib/server/chefs/config';
import { listSubmissions, downloadFile } from '$lib/server/chefs/client';
import { runOneSync } from '$lib/server/chefs/sync';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
	return { canDelete: env.ALLOW_ADMIN_SUBMISSION_DELETION !== '1' ? false : true};
};

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const actions: Actions = {
	seed: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'seed', error: 'CSRF token mismatch' });
		}
		const result = await seedMockSubmissions({
			db,
			attachmentsDir: env.ATTACHMENTS_DIR ?? './attachments'
		});
		auditLog(
			'admin_seeded',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: `seeded ${result.submissions} submissions, ${result.invalid} invalid, ${result.attachments} attachments, ${result.ocrResults} OCR results`
			},
			locals.logger
		);
		return {
			action: 'seed',
			success: `Seeded ${result.submissions} submissions, ${result.invalid} invalid, ${result.attachments} attachments, ${result.ocrResults} OCR results.`
		};
	},

	clear: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		if (env.ALLOW_ADMIN_SUBMISSION_DELETION !== '1') {
			return fail(403, { action: 'clear', error: 'cannot delete submissions in prod' });
		}
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'clear', error: 'CSRF token mismatch' });
		}
		await clearAllSubmissions({
			db,
			attachmentsDir: env.ATTACHMENTS_DIR ?? './attachments'
		});
		auditLog(
			'admin_cleared',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'clear', success: 'Submissions, metadata, and attachments cleared.' };
	},

	clearInvalidAndSync: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'clearInvalidAndSync', error: 'CSRF token mismatch' });
		}
		await db.run(sql`DELETE FROM invalid_submissions WHERE resolved_at IS NULL AND resolved_by IS NULL AND resolved_note IS NULL`);
		auditLog(
			'invalid_submissions_cleared',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		const cfg = getEffectiveConfig(db, env as Record<string, string | undefined>);
		try {
			const res = await runOneSync(db, cfg, {
				list: (c) => listSubmissions(c, { fetch }),
				download: (fileId) => downloadFile(cfg, fileId, { fetch }, locals.logger),
				attachmentsDir: env.ATTACHMENTS_DIR ?? './attachments',
				logger: locals.logger,
				actorUserId: locals.user!.id
			});
			return {
				action: 'clearInvalidAndSync',
				success: `Invalid submissions cleared and re-synced: ingested=${res.ingested}, invalid=${res.invalid}, skipped=${res.skippedDuplicate}.`
			};
		} catch (e) {
			return fail(500, { action: 'clearInvalidAndSync', error: `Cleared invalid submissions but sync failed: ${(e as Error).message}` });
		}
	}
};
