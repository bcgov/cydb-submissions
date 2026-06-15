import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { runOneSync } from '$lib/server/chefs/sync';
import { getSystemState } from '$lib/server/ocr/system-state';
import type { ChefsConfig } from '$lib/server/chefs/types';
import { ChefsClientError } from '$lib/server/chefs/types';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';

const cfg: ChefsConfig = {
	formId: 'f',
	apiToken: 't',
	version: '0',
	baseUrl: 'https://chefs.test',
	fileComponents: ['simplefile'],
	apiParams: {},
	pollerEnabled: false,
	pollIntervalMs: 60_000
};

const oneValid = (id: string) => ({
	form: { submissionId: id },
	childYouthsFirstName: 'Jordan',
	childYouthsLegalLastName: 'Smith',
	childYouthsDateOfBirth: '2015-06-01T00:00:00-07:00',
	childYouthsGender: 'nonBinaryPerson',
	agreementSignatorysLegalFirstName: 'Alex',
	agreementSignatorysLegalLastName: 'Smith',
	childYouthsDateOfBirth1: '1985-02-20T00:00:00-07:00',
	AgreementSigGender: 'womanGirl',
	AgreementSigRelationship: 'Parent',
	primaryPhoneNumber: '604-555-0100',
	email: 'alex.smith@example.com',
	screening: 'Yes',
	editGrid: [
		{
			AssessmentType: { name: 'Autism Diagnostic Assessment Report/ Assessment' },
			completedBy: { name: 'BCAAN (British Columbia Autism Assessment Network)' },
			dateOfAssessment: '2024-09-10T00:00:00-07:00',
			AttachAssessment: [{ originalName: `report-${id}.pdf`, data: { id: `file-${id}` } }]
		}
	],
	PrimaryCareAndControl: { Yes: true },
	iAmTheAgreementSignatory: {
		'I am the Agreement Signatory having primary care and control of my child, or the legal guardian of this child.': true
	},
	iAmTheAgreementSignatory1: {
		'I am the Agreement Signatory having primary care and control of my child, or the legal guardian of this child.': true
	},
	signature:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
	dateSigned: '2026-06-01T00:00:00-07:00'
});

let db: ReturnType<typeof drizzle<typeof schema>>;
let attachmentsDir: string;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
	attachmentsDir = mkdtempSync(path.join(os.tmpdir(), 'cydb-sync-'));
});

describe('runOneSync', () => {
	it('returns ingested + skipped counts and writes chefs.lastSync', async () => {
		const list = vi.fn().mockResolvedValue([oneValid('A'), oneValid('B'), oneValid('A')]);
		const download = vi
			.fn()
			.mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'application/pdf' });
		const res = await runOneSync(db, cfg, { list, download, attachmentsDir, logger: stubLogger() });
		expect(res.fetched).toBe(3);
		expect(res.ingested).toBe(2);
		expect(res.skippedDuplicate).toBe(1);
		expect(res.invalid).toBe(0);
		expect(getSystemState<{ finishedAt: string }>(db, 'chefs.lastSync')?.finishedAt).toBeTruthy();
	});

	it('rethrows the original error and increments failureCount', async () => {
		const err = new ChefsClientError('Unauthorized', 'denied', 401);
		const list = vi.fn().mockRejectedValue(err);
		const download = vi.fn();
		await expect(
			runOneSync(db, cfg, { list, download, attachmentsDir, logger: stubLogger() })
		).rejects.toBe(err);
		expect(getSystemState<number>(db, 'chefs.failureCount')).toBe(1);
	});

	it('halts after the configured threshold of consecutive failures', async () => {
		const err = new ChefsClientError('NetworkError', 'down');
		const list = vi.fn().mockRejectedValue(err);
		const download = vi.fn();
		for (let i = 0; i < 3; i++) {
			await expect(
				runOneSync(db, cfg, {
					list,
					download,
					attachmentsDir,
					logger: stubLogger(),
					failureThreshold: 3
				})
			).rejects.toBe(err);
		}
		expect(getSystemState<{ trippedAt: string }>(db, 'chefs.halted')?.trippedAt).toBeTruthy();
	});

	it('resets failureCount on a successful run', async () => {
		const list = vi.fn().mockResolvedValue([]);
		const download = vi.fn();
		db.insert(schema.systemState).values({ key: 'chefs.failureCount', value: '2' }).run();
		await runOneSync(db, cfg, { list, download, attachmentsDir, logger: stubLogger() });
		expect(getSystemState<number>(db, 'chefs.failureCount')).toBe(0);
	});
});

function stubLogger() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => stubLogger() } as any;
}
