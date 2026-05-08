import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { dbPing, attachmentsDirOk } from '$lib/server/health';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

describe('health probes', () => {
  it('dbPing returns true for a live DB', async () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    expect(await dbPing(db as never)).toBe(true);
    sqlite.close();
  });

  it('attachmentsDirOk returns true for a writable dir', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'cydb-health-'));
    try {
      expect(attachmentsDirOk(tmp)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('attachmentsDirOk returns false when the dir does not exist', () => {
    expect(attachmentsDirOk('/this/path/does/not/exist')).toBe(false);
  });
});
