import { randomUUID } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { leaseNextJob, releaseJob } from './lease';
import { processOneJob } from './process-job';
import { Breaker } from './breaker';
import type { OcrProvider } from './types';
import type { Mailer } from '../mail/types';
import type { KeywordScanClient } from '../search/types';

type Db = BetterSQLite3Database<typeof schema>;

export interface WorkerOpts {
	db: Db;
	provider: OcrProvider;
	mailer: Mailer;
	keywords: Map<string, Map<string, string | string []>>;
	keywordScanClient: KeywordScanClient;
	logger: Logger;
	breakerThreshold: number;
	alertRecipients: string[];
	alertFrom: string;
	pollIntervalMs?: number;
	maxConcurrency?: number;
	onIndexed?: (submissionId: number) => Promise<void>;
}

export interface WorkerHandle {
	stop: () => Promise<void>;
	workerId: string;
}

export function startWorker(opts: WorkerOpts): WorkerHandle {
	const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
	const breaker = new Breaker({
		db: opts.db,
		mailer: opts.mailer,
		logger: opts.logger,
		threshold: opts.breakerThreshold,
		recipients: opts.alertRecipients,
		from: opts.alertFrom
	});
	const concurrency = Math.min(Math.max(opts.maxConcurrency ?? 1, 1), 4);
	const intervalMs = opts.pollIntervalMs ?? 1000;
	let running = true;
	let inFlight = 0;

	async function tickOnce(): Promise<void> {
		if (!running) return;
		if (breaker.isTripped()) return;
		while (inFlight < concurrency) {
			const lease = leaseNextJob(opts.db, workerId);
			if (!lease) return;
			inFlight++;
			processOneJob({
				db: opts.db,
				jobId: lease.id,
				provider: opts.provider,
				keywords: opts.keywords,
				keywordScanClient: opts.keywordScanClient,
				logger: opts.logger,
				onIndexed: opts.onIndexed
			})
				.then(async (r) => {
					if (r.outcome === 'succeeded') breaker.recordSuccess();
					else if (r.outcome === 'failed')
						await breaker.recordFailure({ jobId: lease.id, errorClass: r.errorClass ?? 'UnknownError' });
					// 'retried' is a *transient* failure; only terminal failures advance the breaker.
				})
				.catch((e) => {
					opts.logger.error(
						{ event: 'ocr_attempt_failed', jobId: lease.id, errorClass: 'WorkerError', message: (e as Error).message },
						'unexpected worker error'
					);
					releaseJob(opts.db, lease.id, {
						errorClass: 'WorkerError',
						nextAttemptAt: new Date(Date.now() + 60_000).toISOString()
					});
				})
				.finally(() => {
					inFlight--;
				});
		}
	}

	const handle = setInterval(() => {
		void tickOnce();
	}, intervalMs);

	opts.logger.info(
		{ event: 'queue_resumed', workerId, pollIntervalMs: intervalMs, concurrency },
		'OCR worker started'
	);

	return {
		workerId,
		async stop() {
			running = false;
			clearInterval(handle);
			const deadline = Date.now() + 5000;
			while (inFlight > 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}
		}
	};
}
