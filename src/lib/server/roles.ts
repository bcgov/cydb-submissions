import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { userRoles, revokedUserRoles } from './db/schema';
import type { Role } from './auth-types';
import type { db as Db } from './db';

export type DrizzleDb = typeof Db;

export async function getRevokedRoles(db: DrizzleDb, userId: string): Promise<Set<Role>> {
	const rows = await db
		.select({ role: revokedUserRoles.role })
		.from(revokedUserRoles)
		.where(eq(revokedUserRoles.userId, userId));
	return new Set(rows.map((r) => r.role as Role));
}

export async function getUserRoles(db: DrizzleDb, userId: string): Promise<Set<Role>> {
	const [granted, revoked] = await Promise.all([
		db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
		getRevokedRoles(db, userId)
	]);
	return new Set(granted.map((r) => r.role as Role).filter((r) => !revoked.has(r)));
}

export function userHasAnyRole(have: Set<Role>, ...want: Role[]): boolean {
	return want.some((r) => have.has(r));
}

export async function revokeRole(
	db: DrizzleDb,
	args: { userId: string; role: Role; reason?: string | null; revokedBy: string }
): Promise<void> {
	await db
		.insert(revokedUserRoles)
		.values({
			userId: args.userId,
			role: args.role,
			reason: args.reason ?? null,
			revokedBy: args.revokedBy
		})
		.onConflictDoNothing(); // idempotent on the (user_id, role) unique index
}

export async function restoreRole(db: DrizzleDb, userId: string, role: Role): Promise<void> {
	await db
		.delete(revokedUserRoles)
		.where(and(eq(revokedUserRoles.userId, userId), eq(revokedUserRoles.role, role)));
}

/** Self-lockout guard: an admin may not revoke their own `admin` role. */
export function isSelfAdminRevoke(actorUserId: string, targetUserId: string, role: Role): boolean {
	return actorUserId === targetUserId && role === 'admin';
}

interface RoleCtx {
	user: { id: string } | null;
	roles: Set<Role>;
}

export function requireRole(ctx: RoleCtx, ...allowed: Role[]): void {
	if (!ctx.user) throw error(401, 'login required');
	if (!userHasAnyRole(ctx.roles, ...allowed)) throw error(403, 'forbidden');
}

export function redirectToLogin(currentPath: string): never {
	throw redirect(303, `/login?next=${encodeURIComponent(currentPath)}`);
}
