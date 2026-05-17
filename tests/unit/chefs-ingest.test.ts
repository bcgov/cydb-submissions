import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { ingestOne } from '$lib/server/chefs/ingest';
import type { ChefsConfig } from '$lib/server/chefs/types';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';

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

const validRaw = {
  form: { submissionId: 'sub-uuid-A' },
  childInfo: { dateOfBirth: '2018-04-12', primaryLanguage: 'English' },
  developmentalHistory: { developmentalConcerns: true, ageOfFirstConcern: '1-2' },
  diagnosis: { hasFormalDiagnosis: true, diagnosticStatus: 'Confirmed', assessmentTools: ['Vineland'] },
  functionalImpact: { communication: '2', socialInteraction: '2', dailyLivingSkills: '1', behaviouralConcerns: '1' },
  coOccurringConditions: { conditions: ['ADHD'] },
  currentSupports: { services: ['SLP'], weeklyHours: 5 },
  consent: { informationAccurate: true, dataSharingConsent: true },
  simplefile: [{ data: { id: 'file-A' }, originalName: 'report.pdf' }]
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let attachmentsDir: string;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
  attachmentsDir = mkdtempSync(path.join(os.tmpdir(), 'cydb-chefs-'));
});

describe('ingestOne', () => {
  it('downloads files, writes the submission, and enqueues an OCR job', async () => {
    const download = vi.fn().mockResolvedValue({
      bytes: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf'
    });
    const res = await ingestOne(db, cfg, validRaw, { download, attachmentsDir, logger: stubLogger() });
    expect(res.outcome).toBe('ingested');
    expect(res.submissionUuid).toBe('chefs_sub-uuid-A');

    const subs = db.select().from(schema.submissions).all();
    expect(subs).toHaveLength(1);
    expect(subs[0].submissionUuid).toBe('chefs_sub-uuid-A');

    const atts = db.select().from(schema.submissionAttachments).all();
    expect(atts).toHaveLength(1);
    expect(atts[0].originalFilename).toBe('report.pdf');
    expect(existsSync(atts[0].storedPath)).toBe(true);
    expect(readFileSync(atts[0].storedPath).toString()).toBe('pdf-bytes');

    const jobs = db.select().from(schema.ocrJobs).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('queued');
  });

  it('skips when the submission_uuid already exists', async () => {
    const download = vi.fn().mockResolvedValue({ bytes: Buffer.alloc(1), mimeType: 'application/pdf' });
    await ingestOne(db, cfg, validRaw, { download, attachmentsDir, logger: stubLogger() });
    const second = await ingestOne(db, cfg, validRaw, { download, attachmentsDir, logger: stubLogger() });
    expect(second.outcome).toBe('skipped');
    expect(db.select().from(schema.submissions).all()).toHaveLength(1);
  });

  it('skips when the submission_uuid already exists in invalid_submissions', async () => {
    db.insert(schema.invalidSubmissions).values({
      submissionUuid: 'chefs_sub-uuid-A',
      rawPayload: '{}',
      validationErrors: []
    }).run();
    const download = vi.fn();
    const second = await ingestOne(db, cfg, validRaw, { download, attachmentsDir, logger: stubLogger() });
    expect(second.outcome).toBe('skipped');
    expect(download).not.toHaveBeenCalled();
  });

  it('writes to invalid_submissions when validation fails', async () => {
    const bad = { ...validRaw, consent: { informationAccurate: false, dataSharingConsent: true } };
    const download = vi.fn();
    const res = await ingestOne(db, cfg, bad, { download, attachmentsDir, logger: stubLogger() });
    expect(res.outcome).toBe('invalid');
    expect(download).not.toHaveBeenCalled();
    const invalid = db.select().from(schema.invalidSubmissions).all();
    expect(invalid).toHaveLength(1);
    expect(invalid[0].submissionUuid).toBe('chefs_sub-uuid-A');
  });

  it('strips path components from attachment filenames before writing', async () => {
    const malicious = {
      ...validRaw,
      form: { submissionId: 'sub-uuid-MAL' },
      simplefile: [{ data: { id: 'file-MAL' }, originalName: '../../escape.pdf' }]
    };
    const download = vi.fn().mockResolvedValue({
      bytes: Buffer.from('payload'),
      mimeType: 'application/pdf'
    });
    await ingestOne(db, cfg, malicious, { download, attachmentsDir, logger: stubLogger() });
    const atts = db.select().from(schema.submissionAttachments).all();
    expect(atts).toHaveLength(1);
    // stored path must remain inside attachmentsDir/{submissionUuid}/
    const expectedDir = path.join(attachmentsDir, 'chefs_sub-uuid-MAL');
    expect(atts[0].storedPath).toBe(path.join(expectedDir, 'escape.pdf'));
    expect(atts[0].storedPath.startsWith(expectedDir + path.sep)).toBe(true);
  });
});

function stubLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => stubLogger() } as any;
}
