import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireRole } from '$lib/server/roles';
import { listAllReasons, addReason, editReason, setReasonActive } from '$lib/server/reasons';
import { auditLog } from '$lib/server/audit';

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
	return { reasons: await listAllReasons(db) };
};

export const actions: Actions = {
	add: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { error: 'CSRF token mismatch' });
		const text = form.get('text')?.toString().trim();
		if (!text) return fail(400, { error: 'Reason text is required.' });
		try {
			await addReason(db, text);
		} catch {
			return fail(400, { error: 'That reason already exists.' });
		}
		auditLog(
			'reason_added',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				reason: text,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { success: `Added "${text}".` };
	},
	edit: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { error: 'CSRF token mismatch' });
		const id = Number(form.get('id'));
		const text = form.get('text')?.toString().trim();
		if (!Number.isInteger(id) || id <= 0 || !text) return fail(400, { error: 'Invalid edit.' });
		await editReason(db, id, text);
		auditLog(
			'reason_edited',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				reasonId: id,
				reason: text,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { success: 'Reason updated.' };
	},
	setActive: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { error: 'CSRF token mismatch' });
		const id = Number(form.get('id'));
		const active = form.get('active') === 'true';
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid reason.' });
		await setReasonActive(db, id, active);
		auditLog(
			active ? 'reason_reactivated' : 'reason_deactivated',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				reasonId: id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { success: active ? 'Reason reactivated.' : 'Reason deactivated.' };
	}
};
