import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireRole } from '$lib/server/roles';
import { listAllReasons, addReason, editReason, setReasonActive, addReasonAccept, editReasonAccept, listAllAcceptReasons, setReasonActiveAccept } from '$lib/server/reasons';
import { auditLog } from '$lib/server/audit';

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
	return { reasons: await listAllReasons(db), acceptReasons: await listAllAcceptReasons(db) };
};

export const actions: Actions = {
	add: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'add', error: 'CSRF token mismatch' });
		const text = form.get('text')?.toString().trim();
		if (!text) return fail(400, { action: 'add', error: 'Reason text is required.' });
		try {
			await addReason(db, text);
		} catch {
			return fail(400, {  action: 'add', error: 'That reason already exists.' });
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
		return { action: 'add', success: `Added "${text}".` };
	},
	edit: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'edit', error: 'CSRF token mismatch' });
		const id = Number(form.get('id'));
		const text = form.get('text')?.toString().trim();
		if (!Number.isInteger(id) || id <= 0 || !text) return fail(400, { action: 'edit', error: 'Invalid edit.' });
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
		return { action: 'edit', success: 'Reason updated.' };
	},
	setActive: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'setActive', error: 'CSRF token mismatch' });
		const id = Number(form.get('id'));
		const active = form.get('active') === 'true';
		if (!Number.isInteger(id) || id <= 0) return fail(400, { action: 'setActive', error: 'Invalid reason.' });
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
		return { action: 'setActive', success: active ? 'Reason reactivated.' : 'Reason deactivated.' };
	},

	addAccept: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'addAccept', error: 'CSRF token mismatch' });
		const text = form.get('text')?.toString().trim();
		if (!text) return fail(400, { action: 'addAccept', error: 'Reason text is required.' });
		try {
			await addReasonAccept(db, text);
		} catch {
			return fail(400, { action: 'addAccept', error: 'That reason already exists.' });
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
		return { action: 'addAccept', success: `Added "${text}".` };
	},
	editAccept: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'editAccept', error: 'CSRF token mismatch' });
		const id = Number(form.get('id'));
		const text = form.get('text')?.toString().trim();
		if (!Number.isInteger(id) || id <= 0 || !text) return fail(400, { action: 'editAccept', error: 'Invalid edit.' });
		await editReasonAccept(db, id, text);
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
		return { action: 'editAccept', success: 'Reason updated.' };
	},
	setActiveAccept: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf')))
			return fail(403, { action: 'setActiveAccept', error: 'CSRF token mismatch' });
		const id = Number(form.get('id'));
		const active = form.get('active') === 'true';
		if (!Number.isInteger(id) || id <= 0) return fail(400, { action: 'setActiveAccept', error: 'Invalid reason.' });
		await setReasonActiveAccept(db, id, active);
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
		return { action: 'setActiveAccept', success: active ? 'Reason reactivated.' : 'Reason deactivated.' };
	}
};
