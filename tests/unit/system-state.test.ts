import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { getSystemState, setSystemState, clearSystemState } from '$lib/server/ocr/system-state';
import path from 'node:path';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('system-state', () => {
  it('returns null when key absent', () => {
    expect(getSystemState(db, 'nope')).toBeNull();
  });
  it('round-trips a JSON value', () => {
    setSystemState(db, 'ocr.halted', { reason: 'breaker', tripped: 4 });
    expect(getSystemState(db, 'ocr.halted')).toEqual({ reason: 'breaker', tripped: 4 });
  });
  it('clears a key', () => {
    setSystemState(db, 'ocr.halted', { reason: 'x' });
    clearSystemState(db, 'ocr.halted');
    expect(getSystemState(db, 'ocr.halted')).toBeNull();
  });
  it('upserts on the same key', () => {
    setSystemState(db, 'k', { a: 1 });
    setSystemState(db, 'k', { a: 2 });
    expect(getSystemState(db, 'k')).toEqual({ a: 2 });
  });
});
