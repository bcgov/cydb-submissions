import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveAttachments } from '../../src/lib/server/storage';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'cydb-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function file(name: string, body: string, type = 'text/plain') {
  return new File([new TextEncoder().encode(body)], name, { type });
}

describe('saveAttachments', () => {
  it('writes per-submission directory keyed by uuid', async () => {
    const r = await saveAttachments({ baseDir: dir, submissionUuid: 'sub_1' }, [file('a.txt', 'hi')]);
    expect(r).toHaveLength(1);
    expect(r[0].storedPath).toBe(path.join(dir, 'sub_1', 'a.txt'));
    expect(r[0].sizeBytes).toBe(2);
    const body = await readFile(r[0].storedPath, 'utf8');
    expect(body).toBe('hi');
  });
  it('preserves original filenames', async () => {
    const r = await saveAttachments(
      { baseDir: dir, submissionUuid: 'sub_2' },
      [file('Some Spaced Name.pdf', 'x'), file('résumé.txt', 'y')]
    );
    expect(r[0].originalFilename).toBe('Some Spaced Name.pdf');
    expect(r[1].originalFilename).toBe('résumé.txt');
  });
  it('rejects oversized files', async () => {
    await expect(
      saveAttachments({ baseDir: dir, submissionUuid: 'sub_3', maxBytes: 1 }, [file('big.txt', 'too big')])
    ).rejects.toThrow(/too large/i);
  });
  it('rejects disallowed mime types', async () => {
    const exe = file('evil.exe', 'x', 'application/x-msdownload');
    await expect(
      saveAttachments(
        { baseDir: dir, submissionUuid: 'sub_4', allowedMime: new Set(['application/pdf']) },
        [exe]
      )
    ).rejects.toThrow(/not allowed/i);
  });
});
