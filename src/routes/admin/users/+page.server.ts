import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user, userRoles, revokedUserRoles } from '$lib/server/db/schema';
import { requireRole, revokeRole, restoreRole, isSelfAdminRevoke } from '$lib/server/roles';
import { shapeUserRoleRows, type GrantInput, type RevokedRowInput } from '$lib/server/role-admin';
import { auditLog } from '$lib/server/audit';
import { ROLES, type Role } from '$lib/server/auth-types';

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
	const [users, grants, revocations] = await Promise.all([
		db.select({ id: user.id, name: user.name, email: user.email }).from(user),
		db.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles),
		db
			.select({
				userId: revokedUserRoles.userId,
				role: revokedUserRoles.role,
				reason: revokedUserRoles.reason,
				revokedAt: revokedUserRoles.revokedAt,
				revokedBy: revokedUserRoles.revokedBy
			})
			.from(revokedUserRoles)
	]);
	return {
		rows: shapeUserRoleRows(users, grants as GrantInput[], revocations as RevokedRowInput[]),
		currentUserId: locals.user!.id
	};
};

export const actions: Actions = {
	revoke: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'revoke', error: 'CSRF token mismatch' });
		}
		const userId = String(form.get('userId') ?? '');
		const role = String(form.get('role') ?? '') as Role;
		const reason = form.get('reason')?.toString().trim() || null;
		if (!userId || !(ROLES as readonly string[]).includes(role)) {
			return fail(400, { action: 'revoke', error: 'Invalid user or role.' });
		}
		if (isSelfAdminRevoke(locals.user!.id, userId, role)) {
			return fail(400, { action: 'revoke', error: "You can't revoke your own admin role." });
		}
		await revokeRole(db, { userId, role, reason, revokedBy: locals.user!.id });
		auditLog(
			'role_revoked',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				targetUserId: userId,
				targetRole: role,
				reason: reason ?? undefined,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'revoke', success: `Revoked ${role}.` };
	},

	restore: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'restore', error: 'CSRF token mismatch' });
		}
		const userId = String(form.get('userId') ?? '');
		const role = String(form.get('role') ?? '') as Role;
		if (!userId || !(ROLES as readonly string[]).includes(role)) {
			return fail(400, { action: 'restore', error: 'Invalid user or role.' });
		}
		await restoreRole(db, userId, role);
		auditLog(
			'role_restored',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				targetUserId: userId,
				targetRole: role,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		return { action: 'restore', success: `Restored ${role}.` };
	}
};
