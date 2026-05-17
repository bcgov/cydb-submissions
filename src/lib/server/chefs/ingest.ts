import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { writeValidSubmission, writeInvalidSubmission } from '../submissions';
import { mapChefsSubmission } from './mapper';
import type { ChefsConfig, ChefsFileRef, ChefsSubmissionRaw } from './types';
import type { DownloadedFile } from './client';
import type { SavedAttachment } from '../storage';
import type { SubmissionMetadata } from '../metadata';

type Db = BetterSQLite3Database<typeof schema>;

export interface IngestDeps {
  download: (fileId: string) => Promise<DownloadedFile>;
  attachmentsDir: string;
  logger: Logger;
}

export type IngestOutcome = 'ingested' | 'skipped' | 'invalid';

export interface IngestResult {
  submissionUuid: string;
  outcome: IngestOutcome;
}

function uuidExists(db: Db, submissionUuid: string): boolean {
  const inSubs = db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(eq(schema.submissions.submissionUuid, submissionUuid))
    .all();
  if (inSubs.length > 0) return true;
  const inInvalid = db
    .select({ id: schema.invalidSubmissions.id })
    .from(schema.invalidSubmissions)
    .where(eq(schema.invalidSubmissions.submissionUuid, submissionUuid))
    .all();
  return inInvalid.length > 0;
}

async function downloadAndPersist(
  refs: ChefsFileRef[],
  submissionUuid: string,
  deps: IngestDeps
): Promise<SavedAttachment[]> {
  const dir = path.join(deps.attachmentsDir, submissionUuid);
  await mkdir(dir, { recursive: true });
  const out: SavedAttachment[] = [];
  for (const ref of refs) {
    const dl = await deps.download(ref.fileId);
    const stored = path.join(dir, ref.originalName);
    await writeFile(stored, dl.bytes);
    out.push({
      originalFilename: ref.originalName,
      storedPath: stored,
      sizeBytes: dl.bytes.length,
      mimeType: dl.mimeType,
      sha256: createHash('sha256').update(dl.bytes).digest('hex')
    });
  }
  return out;
}

export async function ingestOne(
  db: Db,
  cfg: ChefsConfig,
  raw: ChefsSubmissionRaw,
  deps: IngestDeps
): Promise<IngestResult> {
  const mapped = mapChefsSubmission(raw, cfg);

  if (uuidExists(db, mapped.submissionUuid)) {
    deps.logger.info({ submissionUuid: mapped.submissionUuid }, 'chefs ingest: skipping duplicate');
    return { submissionUuid: mapped.submissionUuid, outcome: 'skipped' };
  }

  if (mapped.validationErrors) {
    deps.logger.warn(
      { submissionUuid: mapped.submissionUuid, errors: mapped.validationErrors },
      'chefs ingest: validation failed'
    );
    await writeInvalidSubmission(db, {
      submissionUuid: mapped.submissionUuid,
      rawPayload: mapped.rawPayloadJson,
      validationErrors: mapped.validationErrors,
      ipAddress: null,
      userAgent: 'chefs-poller'
    });
    return { submissionUuid: mapped.submissionUuid, outcome: 'invalid' };
  }

  const saved = await downloadAndPersist(mapped.attachments, mapped.submissionUuid, deps);

  const metadata: SubmissionMetadata = {
    ipAddress: null,
    userAgent: 'chefs-poller',
    acceptLanguage: null,
    referer: null,
    requestMethod: 'POLL',
    tlsVersion: null,
    sessionId: null,
    browserFingerprint: null,
    csrfTokenEcho: null,
    submissionTimestamp: new Date().toISOString()
  };

  await writeValidSubmission(db, {
    submissionUuid: mapped.submissionUuid,
    payload: mapped.payload,
    metadata,
    attachments: saved
  });

  deps.logger.info({ submissionUuid: mapped.submissionUuid }, 'chefs ingest: ingested');
  return { submissionUuid: mapped.submissionUuid, outcome: 'ingested' };
}
