import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { getSystemState } from '../ocr/system-state';
import { runOneSync } from './sync';
import type { ChefsConfig } from './types';
import type { DownloadedFile } from './client';

type Db = BetterSQLite3Database<typeof schema>;

export interface PollerOpts {
  db: Db;
  getConfig: () => ChefsConfig;
  logger: Logger;
  list: (cfg: ChefsConfig) => Promise<unknown[]>;
  download: (fileId: string) => Promise<DownloadedFile>;
  attachmentsDir: string;
}

export interface PollerHandle {
  stop: () => Promise<void>;
}

export function startPoller(opts: PollerOpts): PollerHandle {
  let stopped = false;
  let inFlight: Promise<unknown> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const cfg = opts.getConfig();

  const tick = async () => {
    if (stopped) return;
    if (inFlight) return;
    if (getSystemState(opts.db, 'chefs.halted')) return;
    const live = opts.getConfig();
    if (!live.pollerEnabled) return;
    inFlight = runOneSync(opts.db, live, {
      list: opts.list,
      download: opts.download,
      attachmentsDir: opts.attachmentsDir,
      logger: opts.logger
    }).catch((e) => {
      opts.logger.error(
        { event: 'chefs_sync_failed', message: (e as Error).message },
        'chefs sync failed'
      );
    });
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };

  if (cfg.pollerEnabled) {
    void tick();
    timer = setInterval(() => void tick(), cfg.pollIntervalMs);
  }

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (inFlight) await inFlight.catch(() => {});
    }
  };
}
