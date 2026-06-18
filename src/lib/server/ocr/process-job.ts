import fs from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import type { OcrProvider } from './types';
import { OcrError } from './types';
import { releaseJob, markTerminal } from './lease';
import { recomputeSubmissionStatus } from './status-transition';
import { scanKeywords } from './keywords';
import { MAX_ATTEMPTS, nextAttemptAt } from './retry';

type Db = BetterSQLite3Database<typeof schema>;

export interface ProcessOpts {
	db: Db;
	jobId: number;
	provider: OcrProvider;
	keywords: Map<string, Map<string, string | string []>>;
	logger: Logger;
	/** Optional: push the submission to the search index after a successful OCR commit. */
	onIndexed?: (submissionId: number) => Promise<void>;
}

export type ProcessOutcome = 'succeeded' | 'retried' | 'failed';

export interface ProcessResult {
	outcome: ProcessOutcome;
	errorClass?: string;
}

export async function processOneJob(opts: ProcessOpts): Promise<ProcessResult> {
	const { db, jobId, provider, keywords, logger } = opts;

	const job = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, jobId)).get();
	if (!job) throw new Error(`processOneJob: job ${jobId} not found`);
	const attachment = db
		.select()
		.from(schema.submissionAttachments)
		.where(eq(schema.submissionAttachments.id, job.attachmentId))
		.get();
	if (!attachment) throw new Error(`processOneJob: attachment ${job.attachmentId} not found`);

	let buf: Buffer;
	try {
		buf = await fs.readFile(attachment.storedPath);
	} catch {
		logger.error(
			{ event: 'ocr_attempt_failed', jobId, attachmentId: attachment.id, errorClass: 'AttachmentReadError' },
			'cannot read attachment'
		);
		return finishFailure(opts, 'AttachmentReadError', job.attempts, attachment.submissionId);
	}

	logger.info(
		{ event: 'ocr_request_sent', jobId, attachmentId: attachment.id, model: provider.modelId },
		'OCR request sent'
	);

	try {
		const analysis = await provider.analyze(buf, attachment.mimeType, attachment.originalFilename, attachment.submissionId, attachment.assessmentIndex);
		db.transaction((tx) => {
			tx.insert(schema.ocrResults)
				.values({
					attachmentId: attachment.id,
					rawText: analysis.rawText,
					pages: analysis.pages,
					modelId: analysis.modelId,
					apiVersion: analysis.apiVersion
				})
				.onConflictDoNothing()
				.run();

			const hits = scanKeywords(analysis.rawText, keywords);
			for (const [category, info] of hits) {
				for (const [keyword, count] of info) {
					tx.insert(schema.keywordHits)
						.values({ 
							submissionId: attachment.submissionId, 
							attachmentId: attachment.id, 
							keyword, 
							count: count, 
							[category]: 1
						}) 
						.onConflictDoUpdate({
							target: [schema.keywordHits.submissionId, schema.keywordHits.keyword, schema.keywordHits.attachmentId], 
							set: { count: count, computedAt: sql`CURRENT_TIMESTAMP` }
						})
						.run();
				}
			}
			markTerminal(tx, jobId, 'succeeded');
			recomputeSubmissionStatus(tx, attachment.submissionId);
		});
		logger.info({ event: 'ocr_succeeded', jobId, attachmentId: attachment.id }, 'OCR succeeded');
		logger.info(
			{ event: 'keyword_hits_recorded', submissionId: attachment.submissionId, jobId },
			'keyword hits recorded'
		);
		if (opts.onIndexed) {
			try {
				await opts.onIndexed(attachment.submissionId);
			} catch (e) {
				logger.error(
					{ event: 'search_index_failed', submissionId: attachment.submissionId, message: (e as Error).message },
					'search index push failed; reconciler will retry'
				);
			}
		}
		return { outcome: 'succeeded' };
	} catch (e) {
		const errorClass = e instanceof OcrError ? e.errorClass : (e as Error)?.message ?? 'UnexpectedError';
		return finishFailure(opts, errorClass, job.attempts, attachment.submissionId);
	}
}

function finishFailure(
	opts: ProcessOpts,
	errorClass: string,
	attemptsBefore: number,
	submissionId: number
): ProcessResult {
	const { db, jobId, logger } = opts;
	const nextAttempts = attemptsBefore + 1;
	if (nextAttempts >= MAX_ATTEMPTS) {
		db.transaction((tx) => {
			markTerminal(tx, jobId, 'failed', errorClass);
			recomputeSubmissionStatus(tx, submissionId);
		});
		logger.error({ event: 'ocr_terminal_failed', jobId, errorClass }, 'OCR terminally failed');
		return { outcome: 'failed', errorClass };
	} else {
		releaseJob(db, jobId, { errorClass, nextAttemptAt: nextAttemptAt(nextAttempts) });
		logger.warn(
			{ event: 'ocr_attempt_failed', jobId, errorClass, attempts: nextAttempts },
			'OCR attempt failed; will retry'
		);
		return { outcome: 'retried', errorClass };
	}
}
