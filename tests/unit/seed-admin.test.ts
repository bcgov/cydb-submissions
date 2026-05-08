import { describe, it, expect } from 'vitest';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { seedAdmin } from '../../scripts/seed-admin.mjs';

import * as schema from '$lib/server/db/schema';

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../src/lib/server/db/migrations')
  });
  return { sqlite, db };
}

describe('seedAdmin', () => {
  it('creates an admin user + role on first run', async () => {
    const { sqlite, db } = freshDb();
    const result = await seedAdmin({
      db,
      email: 'a@x.example',
      password: 'CorrectHorseBattery1!',
      secret: 'x'.repeat(32)
    });
    expect(result.skipped).toBe(false);
    const users = sqlite.prepare(`SELECT email FROM "user"`).all() as Array<{ email: string }>;
    expect(users).toEqual([{ email: 'a@x.example' }]);
    const roles = sqlite.prepare(`SELECT role FROM user_roles`).all();
    expect(roles).toEqual([{ role: 'admin' }]);
  });

  it('is a no-op when users already exist', async () => {
    const { sqlite, db } = freshDb();
    sqlite.prepare(`INSERT INTO "user" (id, name, email, email_verified) VALUES ('x','x','x@y',0)`).run();
    const result = await seedAdmin({
      db,
      email: 'a@x.example',
      password: 'CorrectHorseBattery1!',
      secret: 'x'.repeat(32)
    });
    expect(result.skipped).toBe(true);
    const users = sqlite.prepare(`SELECT email FROM "user"`).all();
    expect(users).toEqual([{ email: 'x@y' }]);
  });
});
