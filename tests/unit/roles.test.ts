import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { getUserRoles, userHasAnyRole, requireRole } from '$lib/server/roles';

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../src/lib/server/db/migrations')
  });
  return { sqlite, db };
}

describe('roles helpers', () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
    ({ sqlite, db } = freshDb());
    sqlite
      .prepare(`INSERT INTO user (id, name, email, email_verified) VALUES ('u1','a','a@x',0)`)
      .run();
  });

  it('returns an empty set when the user has no roles', async () => {
    expect(Array.from(await getUserRoles(db as never, 'u1'))).toEqual([]);
  });

  it('returns all assigned roles', async () => {
    sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1','admin'),('u1','cfd_worker')`).run();
    expect(Array.from(await getUserRoles(db as never, 'u1')).sort()).toEqual(['admin', 'cfd_worker']);
  });

  it('userHasAnyRole returns true when at least one role matches', async () => {
    sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1','clinician')`).run();
    const roles = await getUserRoles(db as never, 'u1');
    expect(userHasAnyRole(roles, 'admin', 'clinician')).toBe(true);
    expect(userHasAnyRole(roles, 'cfd_worker')).toBe(false);
  });

  it('requireRole throws 401 when no user', () => {
    expect(() => requireRole({ user: null, roles: new Set() }, 'admin')).toThrow();
  });

  it('requireRole throws 403 when role missing', () => {
    expect(() =>
      requireRole({ user: { id: 'u1' }, roles: new Set(['clinician']) }, 'admin')
    ).toThrow();
  });

  it('requireRole returns silently when role present', () => {
    expect(() =>
      requireRole({ user: { id: 'u1' }, roles: new Set(['admin']) }, 'admin', 'cfd_worker')
    ).not.toThrow();
  });
});
