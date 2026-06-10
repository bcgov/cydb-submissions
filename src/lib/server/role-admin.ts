import type { Role } from './auth-types';

export type UserSummary = { id: string; name: string; email: string };
export type GrantInput = { userId: string; role: Role };
export type RevokedRowInput = {
	userId: string;
	role: Role;
	reason: string | null;
	revokedAt: string;
	revokedBy: string;
};

export interface UserRoleRow {
	id: string;
	name: string;
	email: string;
	granted: Role[];
	revoked: Array<{ role: Role; reason: string | null; revokedAt: string; revokedBy: string }>;
	effective: Role[];
}

export function shapeUserRoleRows(
	users: UserSummary[],
	grants: GrantInput[],
	revocations: RevokedRowInput[]
): UserRoleRow[] {
	const grantsBy = new Map<string, Role[]>();
	for (const g of grants) grantsBy.set(g.userId, [...(grantsBy.get(g.userId) ?? []), g.role]);
	const revBy = new Map<string, UserRoleRow['revoked']>();
	for (const r of revocations)
		revBy.set(r.userId, [
			...(revBy.get(r.userId) ?? []),
			{ role: r.role, reason: r.reason, revokedAt: r.revokedAt, revokedBy: r.revokedBy }
		]);

	return users
		.map((u) => {
			const granted = grantsBy.get(u.id) ?? [];
			const revoked = revBy.get(u.id) ?? [];
			const revokedSet = new Set(revoked.map((r) => r.role));
			return {
				id: u.id,
				name: u.name,
				email: u.email,
				granted,
				revoked,
				effective: granted.filter((r) => !revokedSet.has(r))
			};
		})
		.sort((a, b) => a.email.localeCompare(b.email));
}
