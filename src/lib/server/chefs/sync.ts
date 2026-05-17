import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { auditLog } from '../audit';
import { getSystemState, setSystemState } from '../ocr/system-state';
import { ingestOne } from './ingest';
import type { ChefsConfig, ChefsSubmissionRaw, SyncResult } from './types';
import type { DownloadedFile } from './client';

type Db = BetterSQLite3Database<typeof schema>;

export interface SyncDeps {
  list: (cfg: ChefsConfig) => Promise<unknown[]>;
  download: (fileId: string) => Promise<DownloadedFile>;
  attachmentsDir: string;
  logger: Logger;
  failureThreshold?: number;
  actorUserId?: string;
}

const FAILURE_KEY = 'chefs.failureCount';
const HALTED_KEY = 'chefs.halted';
const LAST_SYNC_KEY = 'chefs.lastSync';

export async function runOneSync(db: Db, cfg: ChefsConfig, deps: SyncDeps): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const threshold = deps.failureThreshold ?? 3;
  const requestId = 'sync-' + startedAt;

  const basePayload = {
    route: 'chefs-poller',
    requestId,
    ...(deps.actorUserId ? { actorUserId: deps.actorUserId } : {})
  };

  auditLog('chefs_sync_started', basePayload, deps.logger);

  let rawList: unknown[];
  try {
    rawList = await deps.list(cfg);
  } catch (err) {
    const count = (getSystemState<number>(db, FAILURE_KEY) ?? 0) + 1;
    setSystemState(db, FAILURE_KEY, count);
    if (count >= threshold) {
      setSystemState(db, HALTED_KEY, {
        trippedAt: new Date().toISOString(),
        threshold,
        lastErrorClass: (err as Error).name
      });
      auditLog(
        'chefs_poller_halted',
        {
          ...basePayload,
          reason: (err as Error).message
        },
        deps.logger
      );
    }
    throw err;
  }

  const result: SyncResult = {
    startedAt,
    finishedAt: '',
    fetched: rawList.length,
    ingested: 0,
    invalid: 0,
    skippedDuplicate: 0,
    errors: []
  };

  for (const raw of rawList as ChefsSubmissionRaw[]) {
    try {
      const r = await ingestOne(db, cfg, raw, {
        download: deps.download,
        attachmentsDir: deps.attachmentsDir,
        logger: deps.logger
      });
      if (r.outcome === 'ingested') {
        result.ingested++;
        auditLog(
          'chefs_submission_ingested',
          {
            ...basePayload,
            submissionUuid: r.submissionUuid
          },
          deps.logger
        );
      } else if (r.outcome === 'invalid') {
        result.invalid++;
      } else {
        result.skippedDuplicate++;
      }
    } catch (e) {
      result.errors.push({ message: (e as Error).message });
      deps.logger.error(
        { event: 'chefs_ingest_failed', message: (e as Error).message },
        'submission ingestion failed'
      );
    }
  }

  result.finishedAt = new Date().toISOString();
  setSystemState(db, FAILURE_KEY, 0);
  setSystemState(db, LAST_SYNC_KEY, result);
  auditLog(
    'chefs_sync_completed',
    {
      ...basePayload,
      reason: `fetched=${result.fetched} ingested=${result.ingested} invalid=${result.invalid} skipped=${result.skippedDuplicate}`
    },
    deps.logger
  );
  return result;
}
