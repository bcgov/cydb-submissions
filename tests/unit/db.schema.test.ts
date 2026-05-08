import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/lib/server/db/schema';

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });
  return { db, sqlite };
}

describe('database schema', () => {
  it('creates the four Phase 1 tables', () => {
    const { sqlite } = freshDb();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining([
      'submissions', 'submission_metadata', 'submission_attachments', 'invalid_submissions'
    ]));
  });

  it('enforces unique submission_uuid', () => {
    const { sqlite } = freshDb();
    sqlite.exec(`INSERT INTO submissions (submission_uuid, status, raw_payload, informationAccurate, dataSharingConsent) VALUES ('u1', 'submitted', '{}', 1, 1)`);
    expect(() =>
      sqlite.exec(`INSERT INTO submissions (submission_uuid, status, raw_payload, informationAccurate, dataSharingConsent) VALUES ('u1', 'submitted', '{}', 1, 1)`)
    ).toThrow(/UNIQUE/);
  });

  it('cascades attachments delete when submission removed', () => {
    const { sqlite } = freshDb();
    sqlite.exec(`INSERT INTO submissions (submission_uuid, status, raw_payload, informationAccurate, dataSharingConsent) VALUES ('u2','submitted','{}', 1, 1)`);
    const subId = sqlite.prepare(`SELECT id FROM submissions WHERE submission_uuid='u2'`).get() as { id: number };
    sqlite.prepare(
      `INSERT INTO submission_attachments (submission_id, original_filename, stored_path, size_bytes, mime_type, sha256)
       VALUES (?, 'a.pdf', '/x', 10, 'application/pdf', 'abc')`
    ).run(subId.id);
    sqlite.prepare(`DELETE FROM submissions WHERE id = ?`).run(subId.id);
    const remaining = sqlite.prepare(`SELECT count(*) AS c FROM submission_attachments`).get() as { c: number };
    expect(remaining.c).toBe(0);
  });
});

describe('phase 2 schema', () => {
  it('rejects an invalid status enum value', () => {
    const { sqlite } = freshDb();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO submissions (submission_uuid, status, raw_payload, informationAccurate, dataSharingConsent)
           VALUES ('u1', 'bogus', '{}', 1, 1)`
        )
        .run()
    ).toThrow(/CHECK constraint/i);
  });

  it('accepts every documented status value', () => {
    const { sqlite } = freshDb();
    const statuses = [
      'submitted',
      'OCR queued',
      'OCR Error',
      'OCR processed',
      'ready for review',
      'ready for clinician',
      'reviewed',
      'invalid'
    ];
    for (const status of statuses) {
      sqlite
        .prepare(
          `INSERT INTO submissions (submission_uuid, status, raw_payload, informationAccurate, dataSharingConsent)
           VALUES (?, ?, '{}', 1, 1)`
        )
        .run(`u-${status}`, status);
    }
    const count = sqlite.prepare('SELECT count(*) as n FROM submissions').get() as { n: number };
    expect(count.n).toBe(statuses.length);
  });

  it('accepts a submitter_surname value and a NULL value', () => {
    const { sqlite } = freshDb();
    sqlite
      .prepare(
        `INSERT INTO submissions (submission_uuid, status, submitter_surname, raw_payload, informationAccurate, dataSharingConsent)
         VALUES ('u-with', 'submitted', 'Doe', '{}', 1, 1)`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO submissions (submission_uuid, status, raw_payload, informationAccurate, dataSharingConsent)
         VALUES ('u-without', 'submitted', '{}', 1, 1)`
      )
      .run();
    expect(
      sqlite.prepare("SELECT submitter_surname FROM submissions WHERE submission_uuid = 'u-with'").get()
    ).toEqual({ submitter_surname: 'Doe' });
    expect(
      sqlite.prepare("SELECT submitter_surname FROM submissions WHERE submission_uuid = 'u-without'").get()
    ).toEqual({ submitter_surname: null });
  });

  it('user_roles unique-constrains (user_id, role)', () => {
    const { sqlite } = freshDb();
    sqlite
      .prepare(
        `INSERT INTO user (id, name, email, email_verified) VALUES ('u1', 'a', 'a@x', 0)`
      )
      .run();
    sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1', 'admin')`).run();
    expect(() =>
      sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1', 'admin')`).run()
    ).toThrow(/UNIQUE/i);
  });

  it('user_roles rejects unknown role values', () => {
    const { sqlite } = freshDb();
    sqlite
      .prepare(
        `INSERT INTO user (id, name, email, email_verified) VALUES ('u2', 'b', 'b@x', 0)`
      )
      .run();
    expect(() =>
      sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u2', 'wizard')`).run()
    ).toThrow(/CHECK/i);
  });
});
