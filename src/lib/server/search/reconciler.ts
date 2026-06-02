import { randomUUID } from 'node:crypto';
import { isNull, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { indexSubmission } from './indexer';
import type { SearchClient } from './types';

type Db = BetterSQLite3Database<typeof schema>;

/** IDs of submissions not yet reflected in the index (never indexed or stale). */
export function selectDirty(db: Db, batchSize: number): number[] {
	return db
		.select({ id: schema.submissions.id })
		.from(schema.submissions)
		.where(
			or(
				isNull(schema.submissions.searchIndexedAt),
				sql`${schema.submissions.searchIndexedAt} < ${schema.submissions.updatedAt}`
			)
		)
		.limit(batchSize)
		.all()
		.map((r) => r.id);
}

/** Index one batch of dirty rows. Returns how many were indexed. */
export async function reconcileOnce(db: Db, client: SearchClient, batchSize: number): Promise<number> {
	const ids = selectDirty(db, batchSize);
	let n = 0;
	for (const id of ids) {
		if (await indexSubmission(db, client, id)) n++;
	}
	return n;
}

export interface ReconcilerOpts {
	db: Db;
	client: SearchClient;
	logger: Logger;
	pollIntervalMs?: number;
	batchSize?: number;
}

export interface ReconcilerHandle {
	stop: () => void;
	workerId: string;
}

export function startReconciler(opts: ReconcilerOpts): ReconcilerHandle {
	const workerId = `search-${process.pid}-${randomUUID().slice(0, 8)}`;
	const intervalMs = opts.pollIntervalMs ?? 2000;
	const batchSize = opts.batchSize ?? 50;
	let running = true;
	let busy = false;

	const handle = setInterval(async () => {
		if (!running || busy) return;
		busy = true;
		try {
			const n = await reconcileOnce(opts.db, opts.client, batchSize);
			if (n > 0) opts.logger.info({ event: 'search_reconciled', count: n, workerId }, 'search index reconciled');
		} catch (e) {
			opts.logger.error({ event: 'search_reconcile_failed', workerId, message: (e as Error).message }, 'search reconcile failed');
		} finally {
			busy = false;
		}
	}, intervalMs);

	opts.logger.info({ event: 'search_reconciler_started', workerId, intervalMs, batchSize }, 'search reconciler started');
	return { workerId, stop: () => { running = false; clearInterval(handle); } };
}
