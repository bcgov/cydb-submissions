import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { getSystemState, setSystemState } from '../ocr/system-state';
import { runOneSync } from './sync';
import type { ChefsConfig } from './types';
import type { DownloadedFile } from './client';

type Db = BetterSQLite3Database<typeof schema>;

// Submissions whose file downloads 404'd were never ingested. The first fully successful
// poll after this change ingests them with missingAt set; this key records that it happened.
export const MISSING_FILE_BACKFILL_KEY = 'chefs.missingFileBackfill_v1';

export const INGEST_WINDOW_DAYS = 7;

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
			logger: opts.logger,
			// Until the one-time full poll has completed, ingest everything.
			ingestWindowDays: getSystemState(opts.db, MISSING_FILE_BACKFILL_KEY)
				? INGEST_WINDOW_DAYS
				: undefined
		})
			.then((result) => {
				if (result.errors.length > 0 || getSystemState(opts.db, MISSING_FILE_BACKFILL_KEY)) return;
				setSystemState(opts.db, MISSING_FILE_BACKFILL_KEY, {
					ranAt: new Date().toISOString(),
					fetched: result.fetched,
					ingested: result.ingested
				});
				opts.logger.info(
					{ event: 'chefs_missing_file_backfill_done', ingested: result.ingested },
					'one-time full poll for previously failing (404) submissions complete'
				);
			})
			.catch((e) => {
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
