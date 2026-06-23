import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { seedMockSubmissions, clearAllSubmissions } from '$lib/server/admin-seed';

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
	}
};
