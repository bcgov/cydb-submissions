import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { startPoller } from '$lib/server/chefs/poller';
import { setSystemState } from '$lib/server/ocr/system-state';
import type { ChefsConfig } from '$lib/server/chefs/types';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';

const cfg: ChefsConfig = {
  formId: 'f', apiToken: 't', version: '0', baseUrl: 'https://chefs.test',
  fileComponents: ['simplefile'], apiParams: {}, pollerEnabled: true, pollIntervalMs: 50
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let attachmentsDir: string;

beforeEach(() => {
  vi.useFakeTimers();
  const sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
  attachmentsDir = mkdtempSync(path.join(os.tmpdir(), 'cydb-poller-'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startPoller', () => {
  it('runs an initial sync immediately, then on each tick', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const download = vi.fn();
    const handle = startPoller({
      db, getConfig: () => cfg, logger: stubLogger(),
      list, download, attachmentsDir
    });
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(cfg.pollIntervalMs);
    expect(list).toHaveBeenCalledTimes(2);
    await handle.stop();
  });

  it('does not overlap a tick while a previous sync is running', async () => {
    let resolveFirst!: (v: unknown) => void;
    const list = vi.fn()
      .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
      .mockResolvedValue([]);
    const download = vi.fn();
    const handle = startPoller({
      db, getConfig: () => cfg, logger: stubLogger(),
      list, download, attachmentsDir
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(cfg.pollIntervalMs * 3);
    expect(list).toHaveBeenCalledTimes(1);
    resolveFirst([]);
    await vi.advanceTimersByTimeAsync(cfg.pollIntervalMs);
    expect(list).toHaveBeenCalledTimes(2);
    await handle.stop();
  });

  it('skips ticks when chefs.halted is set', async () => {
    setSystemState(db, 'chefs.halted', { trippedAt: 'x' });
    const list = vi.fn().mockResolvedValue([]);
    const download = vi.fn();
    const handle = startPoller({
      db, getConfig: () => cfg, logger: stubLogger(),
      list, download, attachmentsDir
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(cfg.pollIntervalMs * 3);
    expect(list).not.toHaveBeenCalled();
    await handle.stop();
  });

  it('does not start when getConfig returns pollerEnabled=false', async () => {
    const disabled = { ...cfg, pollerEnabled: false };
    const list = vi.fn();
    const download = vi.fn();
    const handle = startPoller({
      db, getConfig: () => disabled, logger: stubLogger(),
      list, download, attachmentsDir
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(cfg.pollIntervalMs * 5);
    expect(list).not.toHaveBeenCalled();
    await handle.stop();
  });

  it('stop() prevents further ticks', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const download = vi.fn();
    const handle = startPoller({
      db, getConfig: () => cfg, logger: stubLogger(),
      list, download, attachmentsDir
    });
    await Promise.resolve();
    await handle.stop();
    list.mockClear();
    await vi.advanceTimersByTimeAsync(cfg.pollIntervalMs * 3);
    expect(list).not.toHaveBeenCalled();
  });
});

function stubLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => stubLogger() } as any;
}
