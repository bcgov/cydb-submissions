import { eq } from 'drizzle-orm';
import { ROLES, type Role } from './auth-types';
import { userRoles } from './db/schema';
import type { DrizzleDb } from './roles';

const ROLE_SET = new Set<string>(ROLES);

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
	const parts = jwt.split('.');
	if (parts.length !== 3) return null;
	try {
		const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
		const parsed = JSON.parse(decoded);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export function extractSsoRoles(accessToken: string, clientId: string): Set<Role> {
	const payload = decodeJwtPayload(accessToken);
	if (!payload) return new Set();
	const out = new Set<Role>();

	// Accept either claim name a Keycloak mapper might emit for the role list.
	const claimArray = (key: string) =>
		Array.isArray(payload[key]) ? (payload[key] as unknown[]) : [];
	const top = [...claimArray('client_roles'), ...claimArray('user_roles')];
	const ra = payload.resource_access;
	const nested =
		ra && typeof ra === 'object'
			? ((ra as Record<string, { roles?: unknown }>)[clientId]?.roles ?? [])
			: [];
	const nestedArr = Array.isArray(nested) ? nested : [];

	for (const r of [...top, ...nestedArr]) {
		if (typeof r === 'string' && ROLE_SET.has(r)) out.add(r as Role);
	}
	return out;
}

/**
 * Union the recognised roles found across several JWTs (e.g. the OAuth access
 * token AND id token). BC Gov's standard realm may carry `client_roles` on the
 * id token rather than the access token, so we check both rather than assume.
 * Null/empty/undefined tokens are ignored.
 */
export function extractRolesFromTokens(
	tokens: Array<string | null | undefined>,
	clientId: string
): Set<Role> {
	const out = new Set<Role>();
	for (const token of tokens) {
		if (typeof token !== 'string' || token.length === 0) continue;
		for (const role of extractSsoRoles(token, clientId)) out.add(role);
	}
	return out;
}

export async function syncUserRoles(
	db: DrizzleDb,
	userId: string,
	roles: Set<Role>
): Promise<void> {
	if (roles.size === 0) return;
	await db.delete(userRoles).where(eq(userRoles.userId, userId));
	for (const role of roles) {
		await db.insert(userRoles).values({ userId, role });
	}
}
