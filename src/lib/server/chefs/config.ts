import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { getSystemState, setSystemState } from '../ocr/system-state';
import type {
  ChefsConfig,
  ChefsConfigInput,
  ChefsRedactedConfig
} from './types';

type Db = BetterSQLite3Database<typeof schema>;
type Env = Record<string, string | undefined>;

const DEFAULTS: ChefsConfig = {
  formId: '',
  apiToken: '',
  version: '0',
  baseUrl: 'https://submit.digital.gov.bc.ca',
  fileComponents: ['simplefile'],
  apiParams: {},
  pollerEnabled: false,
  pollIntervalMs: 60_000
};

const STATE_KEY = 'chefs.config';

function readDb(db: Db): Partial<ChefsConfig> {
  return getSystemState<Partial<ChefsConfig>>(db, STATE_KEY) ?? {};
}

export function saveConfig(db: Db, partial: ChefsConfigInput): void {
  const current = readDb(db);
  const merged: Partial<ChefsConfig> = { ...current };
  for (const k of Object.keys(partial) as Array<keyof ChefsConfigInput>) {
    const v = partial[k];
    if (v === undefined) continue;
    if (k === 'apiToken' && v === '') continue;
    (merged as Record<string, unknown>)[k] = v;
  }
  setSystemState(db, STATE_KEY, merged);
}

export function rotateApiToken(db: Db, newToken: string): void {
  if (!newToken) throw new Error('rotateApiToken requires a non-empty token');
  const current = readDb(db);
  setSystemState(db, STATE_KEY, { ...current, apiToken: newToken });
}

function parseList(env: Env, key: string): string[] | undefined {
  const v = env[key];
  if (!v) return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseObj(env: Env, key: string): Record<string, unknown> | undefined {
  const v = env[key];
  if (!v) return undefined;
  try {
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore — fall through */
  }
  return undefined;
}

function envOverrides(env: Env): Partial<ChefsConfig> {
  const out: Partial<ChefsConfig> = {};
  if (env.CHEFS_FORM_ID) out.formId = env.CHEFS_FORM_ID;
  if (env.CHEFS_API_TOKEN) out.apiToken = env.CHEFS_API_TOKEN;
  if (env.CHEFS_VERSION) out.version = env.CHEFS_VERSION;
  if (env.CHEFS_BASE_URL) out.baseUrl = env.CHEFS_BASE_URL;
  const fc = parseList(env, 'CHEFS_FILE_COMPONENTS');
  if (fc) out.fileComponents = fc;
  const params = parseObj(env, 'CHEFS_API_PARAMS');
  if (params) out.apiParams = params;
  if (env.CHEFS_POLLER_ENABLED === '1') out.pollerEnabled = true;
  if (env.CHEFS_POLL_INTERVAL_MS) {
    const n = Number(env.CHEFS_POLL_INTERVAL_MS);
    if (Number.isFinite(n) && n > 0) out.pollIntervalMs = n;
  }
  return out;
}

export function getEffectiveConfig(db: Db, env: Env): ChefsConfig {
  const fromDb = readDb(db);
  const fromEnv = envOverrides(env);
  const merged: ChefsConfig = { ...DEFAULTS, ...fromDb, ...fromEnv };
  merged.baseUrl = merged.baseUrl.replace(/\/+$/, '');
  return merged;
}

export function redactForClient(db: Db, env: Env): ChefsRedactedConfig {
  const fromDb = readDb(db);
  const fromEnv = envOverrides(env);
  const effective = getEffectiveConfig(db, env);
  const overrides = Object.keys(fromEnv) as Array<keyof ChefsConfig>;
  const apiTokenSource: ChefsRedactedConfig['apiTokenSource'] =
    fromEnv.apiToken ? 'env' : fromDb.apiToken ? 'db' : 'none';
  return {
    formId: effective.formId,
    apiTokenSet: Boolean(effective.apiToken),
    apiTokenSource,
    version: effective.version,
    baseUrl: effective.baseUrl,
    fileComponents: effective.fileComponents,
    apiParams: effective.apiParams,
    pollerEnabled: effective.pollerEnabled,
    pollIntervalMs: effective.pollIntervalMs,
    envOverrides: overrides
  };
}
