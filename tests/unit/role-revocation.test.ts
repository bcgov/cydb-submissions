import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import {
	getUserRoles,
	getRevokedRoles,
	revokeRole,
	restoreRole,
	isSelfAdminRevoke,
	requireRole
} from '$lib/server/roles';
import { shapeUserRoleRows } from '$lib/server/role-admin';

describe('getUserRoles overlay', () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeEach(() => {
		sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys = ON');
		db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });
		sqlite.exec(`INSERT INTO user (id, name, email, email_verified) VALUES ('u1','U','u@x',0)`);
		sqlite.exec(`INSERT INTO user_roles (user_id, role) VALUES ('u1','admin'),('u1','cfd_worker')`);
	});

	afterEach(() => sqlite.close());

	it('returns granted roles when nothing is revoked', async () => {
		expect(await getUserRoles(db as never, 'u1')).toEqual(new Set(['admin', 'cfd_worker']));
	});
	it('subtracts a revoked role (granted − revoked)', async () => {
		await revokeRole(db as never, { userId: 'u1', role: 'admin', reason: 'test', revokedBy: 'u1' });
		expect(await getUserRoles(db as never, 'u1')).toEqual(new Set(['cfd_worker']));
		expect(await getRevokedRoles(db as never, 'u1')).toEqual(new Set(['admin']));
	});
	it('yields an empty set when all granted roles are revoked', async () => {
		await revokeRole(db as never, { userId: 'u1', role: 'admin', revokedBy: 'u1' });
		await revokeRole(db as never, { userId: 'u1', role: 'cfd_worker', revokedBy: 'u1' });
		expect((await getUserRoles(db as never, 'u1')).size).toBe(0);
	});
	it('revokeRole is idempotent on (user, role)', async () => {
		await revokeRole(db as never, { userId: 'u1', role: 'admin', revokedBy: 'u1' });
		await revokeRole(db as never, { userId: 'u1', role: 'admin', revokedBy: 'u1' });
		const n = sqlite.prepare(`SELECT count(*) c FROM revoked_user_roles`).get() as { c: number };
		expect(n.c).toBe(1);
	});
	it('restoreRole re-grants', async () => {
		await revokeRole(db as never, { userId: 'u1', role: 'admin', revokedBy: 'u1' });
		await restoreRole(db as never, 'u1', 'admin');
		expect(await getUserRoles(db as never, 'u1')).toEqual(new Set(['admin', 'cfd_worker']));
	});

	it('a granted-but-revoked admin is denied by requireRole (guard integration)', async () => {
		await revokeRole(db as never, { userId: 'u1', role: 'admin', revokedBy: 'u1' });
		const roles = await getUserRoles(db as never, 'u1');
		expect(roles.has('admin')).toBe(false);
		// requireRole reads the (already-reduced) role set the guard would see.
		expect(() => requireRole({ user: { id: 'u1' }, roles }, 'admin')).toThrow();
		// ...but a role they still hold is allowed.
		expect(() => requireRole({ user: { id: 'u1' }, roles }, 'cfd_worker')).not.toThrow();
	});
});

describe('isSelfAdminRevoke', () => {
	it('is true only for revoking your own admin role', () => {
		expect(isSelfAdminRevoke('u1', 'u1', 'admin')).toBe(true);
		expect(isSelfAdminRevoke('u1', 'u1', 'cfd_worker')).toBe(false);
		expect(isSelfAdminRevoke('u1', 'u2', 'admin')).toBe(false);
	});
});

describe('shapeUserRoleRows', () => {
	it('computes granted / revoked / effective per user', () => {
		const out = shapeUserRoleRows(
			[{ id: 'u1', name: 'U', email: 'u@x' }],
			[
				{ userId: 'u1', role: 'admin' },
				{ userId: 'u1', role: 'cfd_worker' }
			],
			[{ userId: 'u1', role: 'admin', reason: 'x', revokedAt: 't', revokedBy: 'a1' }]
		);
		expect(out).toHaveLength(1);
		expect(out[0].granted.sort()).toEqual(['admin', 'cfd_worker']);
		expect(out[0].revoked.map((r) => r.role)).toEqual(['admin']);
		expect(out[0].effective).toEqual(['cfd_worker']);
	});

	it('returns [] for empty inputs', () => {
		expect(shapeUserRoleRows([], [], [])).toEqual([]);
	});

	it('sorts rows by email', () => {
		const out = shapeUserRoleRows(
			[
				{ id: 'z', name: 'Z', email: 'z@x' },
				{ id: 'a', name: 'A', email: 'a@x' }
			],
			[],
			[]
		);
		expect(out.map((r) => r.email)).toEqual(['a@x', 'z@x']);
	});

	it('gives a user with no grants/revocations empty role arrays', () => {
		const out = shapeUserRoleRows([{ id: 'u9', name: 'N', email: 'n@x' }], [], []);
		expect(out[0]).toMatchObject({ granted: [], revoked: [], effective: [] });
	});
});
