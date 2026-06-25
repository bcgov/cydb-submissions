import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { processOneJob } from '$lib/server/ocr/process-job';
import { StubProvider } from '$lib/server/ocr/provider-stub';
import { insertValidSubmission } from '../helpers/insert-valid-submission';
import { eq } from 'drizzle-orm';
import { createLogger } from '$lib/server/log';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type { KeywordScanClient } from '$lib/server/search/types';

let db: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

function makeKeywordMap(categories: Record<string, string[]>): Map<string, Map<string, string | string[]>> {
	const outer = new Map<string, Map<string, string | string[]>>();
	for (const [cat, kws] of Object.entries(categories)) {
		const inner = new Map<string, string | string[]>();
		inner.set('keywords', kws);
		outer.set(cat, inner);
	}
	return outer;
}

// Stub that counts whole-word case-insensitive occurrences for unit tests.
const simpleCountClient: KeywordScanClient = {
	async scanForKeywords(text, keywords) {
		const result = new Map<string, number>();
		for (const kw of keywords) {
			const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
			const matches = text.match(re);
			if (matches && matches.length > 0) result.set(kw, matches.length);
		}
		return result;
	}
};

async function seed(rawText = 'Patient autism diagnosis confirmed.') {
	const subId = insertValidSubmission(db, { submissionUuid: 't' });
	const sub = [{ id: subId }];
	const filePath = path.join(tmpDir, 'sample.pdf');
	await fs.writeFile(filePath, Buffer.from('not a real pdf'));
	await fs.writeFile(path.join(tmpDir, 'sample.txt'), rawText);
	const att = db
		.insert(schema.submissionAttachments)
		.values({
			submissionId: sub[0].id,
			originalFilename: 'sample.pdf',
			storedPath: filePath,
			sizeBytes: 14,
			mimeType: 'application/pdf',
			sha256: 'h'
		})
		.returning({ id: schema.submissionAttachments.id })
		.all();
	const job = db
		.insert(schema.ocrJobs)
		.values({ attachmentId: att[0].id, status: 'processing', leasedBy: 'w1' })
		.returning({ id: schema.ocrJobs.id })
		.all();
	return {
		submissionId: sub[0].id,
		jobId: job[0].id,
		attachmentId: att[0].id,
		storedPath: filePath
	};
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cydb-ocr-'));
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('processOneJob', () => {
	it('on success: stores ocr_results, writes keyword_hits, marks job succeeded, advances status', async () => {
		const { jobId, attachmentId, submissionId } = await seed('autism IEP autism');
		const provider = new StubProvider({ mode: 'stub', fixtureDir: tmpDir, delayMs: 0 });
		await processOneJob({
			db,
			jobId,
			provider,
			keywords: makeKeywordMap({ neurodevelopmental: ['autism', 'IEP'] }),
			keywordScanClient: simpleCountClient,
			logger: createLogger({ level: 'silent' })
		});
		const result = db
			.select()
			.from(schema.ocrResults)
			.where(eq(schema.ocrResults.attachmentId, attachmentId))
			.get();
		expect(result?.modelId).toBe('stub');
		const hits = db
			.select()
			.from(schema.keywordHits)
			.where(eq(schema.keywordHits.submissionId, submissionId))
			.all();
		expect(hits.find((h) => h.keyword === 'autism')?.count).toBe(2);
		expect(hits.find((h) => h.keyword === 'IEP')?.count).toBe(1);
		const job = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, jobId)).get();
		expect(job?.status).toBe('succeeded');
		const sub = db
			.select()
			.from(schema.submissions)
			.where(eq(schema.submissions.id, submissionId))
			.get();
		expect(sub?.status).toBe('OCR processed');
	});

	it('on transient error before MAX_ATTEMPTS: releases for retry', async () => {
		const { jobId } = await seed();
		const provider = new StubProvider({ mode: 'stub-fail', fixtureDir: tmpDir, delayMs: 0 });
		const r = await processOneJob({
			db,
			jobId,
			provider,
			keywords: makeKeywordMap({}),
			keywordScanClient: simpleCountClient,
			logger: createLogger({ level: 'silent' })
		});
		expect(r.outcome).toBe('retried');
		const job = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, jobId)).get();
		expect(job?.status).toBe('queued');
		expect(job?.attempts).toBe(1);
	});

	it('on terminal error: marks failed and submission OCR Error', async () => {
		const { jobId, submissionId } = await seed();
		db.update(schema.ocrJobs).set({ attempts: 2 }).where(eq(schema.ocrJobs.id, jobId)).run();
		const provider = new StubProvider({ mode: 'stub-fail', fixtureDir: tmpDir, delayMs: 0 });
		const r = await processOneJob({
			db,
			jobId,
			provider,
			keywords: makeKeywordMap({}),
			keywordScanClient: simpleCountClient,
			logger: createLogger({ level: 'silent' })
		});
		expect(r.outcome).toBe('failed');
		const job = db.select().from(schema.ocrJobs).where(eq(schema.ocrJobs.id, jobId)).get();
		expect(job?.status).toBe('failed');
		const sub = db
			.select()
			.from(schema.submissions)
			.where(eq(schema.submissions.id, submissionId))
			.get();
		expect(sub?.status).toBe('OCR Error');
	});

	it('worker drives stub-flaky to terminal success after retries', async () => {
		const { jobId, submissionId } = await seed('autism');
		const provider = new StubProvider({
			mode: 'stub-flaky',
			fixtureDir: tmpDir,
			delayMs: 0,
			flakyFailures: 2
		});
		const logger = createLogger({ level: 'silent' });
		const opts = { db, provider, keywords: makeKeywordMap({ cat: ['autism'] }), keywordScanClient: simpleCountClient, logger };
		// re-lease is implicit because we call processOneJob with the same jobId — flip 'queued' → 'processing'.
		const r1 = await processOneJob({ ...opts, jobId });
		expect(r1.outcome).toBe('retried');
		db.update(schema.ocrJobs).set({ status: 'processing' }).where(eq(schema.ocrJobs.id, jobId)).run();
		const r2 = await processOneJob({ ...opts, jobId });
		expect(r2.outcome).toBe('retried');
		db.update(schema.ocrJobs).set({ status: 'processing' }).where(eq(schema.ocrJobs.id, jobId)).run();
		const r3 = await processOneJob({ ...opts, jobId });
		expect(r3.outcome).toBe('succeeded');
		const sub = db
			.select()
			.from(schema.submissions)
			.where(eq(schema.submissions.id, submissionId))
			.get();
		expect(sub?.status).toBe('OCR processed');
	});

	it('reports AttachmentReadError and treats it as a normal failure', async () => {
		const { jobId } = await seed();
		const att = db.select().from(schema.submissionAttachments).get()!;
		await fs.rm(att.storedPath);
		const provider = new StubProvider({ mode: 'stub', fixtureDir: tmpDir, delayMs: 0 });
		const r = await processOneJob({
			db,
			jobId,
			provider,
			keywords: makeKeywordMap({}),
			keywordScanClient: simpleCountClient,
			logger: createLogger({ level: 'silent' })
		});
		expect(r.outcome).toBe('retried');
		expect(r.errorClass).toBe('AttachmentReadError');
	});
});
