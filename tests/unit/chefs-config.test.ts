import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import path from 'node:path';
import {
  saveConfig,
  rotateApiToken,
  getEffectiveConfig,
  redactForClient
} from '$lib/server/chefs/config';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('chefs config', () => {
  it('returns defaults when no row exists and no env overrides', () => {
    const cfg = getEffectiveConfig(db, {});
    expect(cfg.formId).toBe('');
    expect(cfg.apiToken).toBe('');
    expect(cfg.baseUrl).toBe('https://submit.digital.gov.bc.ca');
    expect(cfg.fileComponents).toEqual(['simplefile']);
    expect(cfg.version).toBe('0');
    expect(cfg.pollerEnabled).toBe(false);
  });

  it('persists and reads back a saved config', () => {
    saveConfig(db, {
      formId: 'abc-uuid',
      apiToken: 'tkn',
      baseUrl: 'https://example.test',
      fileComponents: ['simplefile', 'extra'],
      apiParams: { status: 'COMPLETED' }
    });
    const cfg = getEffectiveConfig(db, {});
    expect(cfg.formId).toBe('abc-uuid');
    expect(cfg.apiToken).toBe('tkn');
    expect(cfg.fileComponents).toEqual(['simplefile', 'extra']);
    expect(cfg.apiParams).toEqual({ status: 'COMPLETED' });
  });

  it('does not overwrite existing token when partial save omits it', () => {
    saveConfig(db, { formId: 'a', apiToken: 'tkn' });
    saveConfig(db, { formId: 'b' });
    const cfg = getEffectiveConfig(db, {});
    expect(cfg.formId).toBe('b');
    expect(cfg.apiToken).toBe('tkn');
  });

  it('rotateApiToken replaces only the token', () => {
    saveConfig(db, { formId: 'a', apiToken: 'old' });
    rotateApiToken(db, 'new');
    expect(getEffectiveConfig(db, {}).apiToken).toBe('new');
    expect(getEffectiveConfig(db, {}).formId).toBe('a');
  });

  it('env variables override DB values', () => {
    saveConfig(db, { formId: 'db-form', apiToken: 'db-tkn', baseUrl: 'https://db.example' });
    const cfg = getEffectiveConfig(db, {
      CHEFS_FORM_ID: 'env-form',
      CHEFS_API_TOKEN: 'env-tkn',
      CHEFS_BASE_URL: 'https://env.example'
    });
    expect(cfg.formId).toBe('env-form');
    expect(cfg.apiToken).toBe('env-tkn');
    expect(cfg.baseUrl).toBe('https://env.example');
  });

  it('redactForClient hides the api token and lists env overrides', () => {
    saveConfig(db, { formId: 'db-form', apiToken: 'db-tkn' });
    const redacted = redactForClient(db, { CHEFS_FORM_ID: 'env-form' });
    expect(redacted).not.toHaveProperty('apiToken');
    expect(redacted.apiTokenSet).toBe(true);
    expect(redacted.apiTokenSource).toBe('db');
    expect(redacted.envOverrides).toContain('formId');
  });

  it('redactForClient reports apiTokenSource=env when env supplies the token', () => {
    const redacted = redactForClient(db, { CHEFS_API_TOKEN: 'env-tkn' });
    expect(redacted.apiTokenSet).toBe(true);
    expect(redacted.apiTokenSource).toBe('env');
    expect(redacted.envOverrides).toContain('apiToken');
  });

  it('redactForClient reports apiTokenSource=none when nothing is set', () => {
    const redacted = redactForClient(db, {});
    expect(redacted.apiTokenSet).toBe(false);
    expect(redacted.apiTokenSource).toBe('none');
  });
});
