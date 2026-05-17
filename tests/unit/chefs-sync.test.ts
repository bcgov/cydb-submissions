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
  childInfo: { dateOfBirth: '2018-04-12', primaryLanguage: 'English' },
  developmentalHistory: { developmentalConcerns: true, ageOfFirstConcern: '1-2' },
  diagnosis: { hasFormalDiagnosis: true, diagnosticStatus: 'Confirmed', assessmentTools: ['Vineland'] },
  functionalImpact: { communication: '2', socialInteraction: '2', dailyLivingSkills: '1', behaviouralConcerns: '1' },
  coOccurringConditions: { conditions: ['ADHD'] },
  currentSupports: { services: ['SLP'], weeklyHours: 5 },
  consent: { informationAccurate: true, dataSharingConsent: true },
  simplefile: [{ data: { id: `file-${id}` }, originalName: 'r.pdf' }]
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
    const download = vi.fn().mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'application/pdf' });
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
          list, download, attachmentsDir, logger: stubLogger(), failureThreshold: 3
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
