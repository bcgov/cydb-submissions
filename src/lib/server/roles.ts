import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { userRoles } from './db/schema';
import type { Role } from './auth-types';
import type { db as Db } from './db';

export type DrizzleDb = typeof Db;

export async function getUserRoles(db: DrizzleDb, userId: string): Promise<Set<Role>> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return new Set(rows.map((r) => r.role as Role));
}

export function userHasAnyRole(have: Set<Role>, ...want: Role[]): boolean {
  return want.some((r) => have.has(r));
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
