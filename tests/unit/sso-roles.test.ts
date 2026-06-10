import { describe, it, expect, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import {
	decodeJwtPayload,
	extractSsoRoles,
	extractRolesFromTokens,
	syncUserRoles
} from '$lib/server/sso-roles';
import * as schema from '$lib/server/db/schema';
import { userRoles } from '$lib/server/db/schema';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('decodeJwtPayload', () => {
	it('returns the middle segment parsed as JSON', () => {
		expect(decodeJwtPayload(jwt({ a: 1, b: 'two' }))).toEqual({ a: 1, b: 'two' });
	});
	it('returns null on a non-JWT string', () => {
		expect(decodeJwtPayload('not.a.jwt-token-at-all')).toBeNull();
	});
	it('returns null on the wrong number of segments', () => {
		expect(decodeJwtPayload('only.two')).toBeNull();
	});
});

describe('extractSsoRoles', () => {
	const cid = 'cydb-submissions-6444';

	it('reads top-level client_roles', () => {
		const t = jwt({ client_roles: ['admin', 'cfd_worker', 'unknown_role'] });
		expect(extractSsoRoles(t, cid)).toEqual(new Set(['admin', 'cfd_worker']));
	});

	it('also reads a top-level user_roles claim (alternate mapper name)', () => {
		const t = jwt({ user_roles: ['clinician', 'unknown_role'] });
		expect(extractSsoRoles(t, cid)).toEqual(new Set(['clinician']));
	});

	it('reads resource_access.<cid>.roles', () => {
		const t = jwt({ resource_access: { [cid]: { roles: ['clinician'] } } });
		expect(extractSsoRoles(t, cid)).toEqual(new Set(['clinician']));
	});

	it('unions both claim shapes', () => {
		const t = jwt({
			client_roles: ['admin'],
			resource_access: { [cid]: { roles: ['cfd_worker'] } }
		});
		expect(extractSsoRoles(t, cid)).toEqual(new Set(['admin', 'cfd_worker']));
	});

	it('ignores roles from other clients in resource_access', () => {
		const t = jwt({ resource_access: { 'some-other-client': { roles: ['admin'] } } });
		expect(extractSsoRoles(t, cid).size).toBe(0);
	});

	it('returns empty set when no role claim is present', () => {
		expect(extractSsoRoles(jwt({}), cid).size).toBe(0);
	});

	it('returns empty set on a broken token', () => {
		expect(extractSsoRoles('broken', cid).size).toBe(0);
	});
});

describe('extractRolesFromTokens', () => {
	const cid = 'cydb-submissions-6444';

	it('finds a role carried only on the id token (not the access token)', () => {
		const accessJwt = jwt({ client_roles: [] });
		const idJwt = jwt({ client_roles: ['admin'] });
		expect(extractRolesFromTokens([accessJwt, idJwt], cid)).toEqual(new Set(['admin']));
	});

	it('unions recognised roles across both JWTs and ignores unknown ones', () => {
		const accessJwt = jwt({ resource_access: { [cid]: { roles: ['cfd_worker'] } } });
		const idJwt = jwt({ client_roles: ['clinician', 'root'] });
		expect(extractRolesFromTokens([accessJwt, idJwt], cid)).toEqual(
			new Set(['cfd_worker', 'clinician'])
		);
	});

	it('ignores null/undefined/empty entries', () => {
		const t = jwt({ client_roles: ['admin'] });
		expect(extractRolesFromTokens([null, undefined, '', t], cid)).toEqual(new Set(['admin']));
	});
});

describe('syncUserRoles', () => {
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeEach(() => {
		const sqlite = new Database(':memory:');
		sqlite.exec(`
			CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
			  email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
			  created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
			INSERT INTO user(id, name, email) VALUES ('u1', 'U One', 'u1@example.com');
			CREATE TABLE user_roles (
			  id INTEGER PRIMARY KEY AUTOINCREMENT,
			  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
			  role TEXT NOT NULL,
			  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX user_roles_unique ON user_roles(user_id, role);
		`);
		db = drizzle(sqlite, { schema });
	});

	it('inserts roles when set is non-empty', async () => {
		await syncUserRoles(db, 'u1', new Set(['admin', 'cfd_worker']));
		const rows = await db.select().from(userRoles);
		expect(rows.map((r) => r.role).sort()).toEqual(['admin', 'cfd_worker']);
	});

	it('is a no-op when set is empty (preserves existing roles)', async () => {
		await db.insert(userRoles).values({ userId: 'u1', role: 'admin' });
		await syncUserRoles(db, 'u1', new Set());
		const rows = await db.select().from(userRoles);
		expect(rows.length).toBe(1);
	});

	it('replaces existing roles when set is non-empty', async () => {
		await db.insert(userRoles).values({ userId: 'u1', role: 'clinician' });
		await syncUserRoles(db, 'u1', new Set(['admin']));
		const rows = await db.select().from(userRoles);
		expect(rows.map((r) => r.role)).toEqual(['admin']);
	});

	it('only touches the targeted user, not others', async () => {
		const sqlite = (db as unknown as { $client: { exec: (sql: string) => void } }).$client;
		sqlite.exec(`INSERT INTO user(id, name, email) VALUES ('u2', 'U Two', 'u2@example.com');`);
		await db.insert(userRoles).values({ userId: 'u2', role: 'clinician' });
		await syncUserRoles(db, 'u1', new Set(['admin']));
		const rows = await db.select().from(userRoles);
		expect(
			rows.sort((a, b) => a.userId.localeCompare(b.userId)).map((r) => `${r.userId}:${r.role}`)
		).toEqual(['u1:admin', 'u2:clinician']);
	});
});
