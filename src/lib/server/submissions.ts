import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema';
import type { SubmissionMetadata } from './metadata';
import type { SavedAttachment } from './storage';
import type { SubmissionInput } from '../form/schema';

export interface WriteValidArgs {
  submissionUuid: string;
  payload: SubmissionInput;
  metadata: SubmissionMetadata;
  attachments: SavedAttachment[];
}

export async function writeValidSubmission(
  db: BetterSQLite3Database<typeof schema>,
  args: WriteValidArgs
): Promise<{ submissionId: number }> {
  return db.transaction((tx) => {
    const inserted = tx
      .insert(schema.submissions)
      .values({
        submissionUuid: args.submissionUuid,
        status: 'submitted',
        dateOfBirth: args.payload.childInfo.dateOfBirth,
        primaryLanguage: args.payload.childInfo.primaryLanguage ?? null,
        developmentalConcerns: args.payload.developmentalHistory.developmentalConcerns ?? null,
        ageOfFirstConcern: args.payload.developmentalHistory.ageOfFirstConcern ?? null,
        hasFormalDiagnosis: args.payload.diagnosis.hasFormalDiagnosis,
        diagnosticStatus: args.payload.diagnosis.diagnosticStatus ?? null,
        assessmentTools: args.payload.diagnosis.assessmentTools ?? null,
        communication: args.payload.functionalImpact.communication ?? null,
        socialInteraction: args.payload.functionalImpact.socialInteraction ?? null,
        dailyLivingSkills: args.payload.functionalImpact.dailyLivingSkills ?? null,
        behaviouralConcerns: args.payload.functionalImpact.behaviouralConcerns ?? null,
        conditions: args.payload.coOccurringConditions.conditions ?? null,
        services: args.payload.currentSupports.services ?? null,
        weeklyHours: args.payload.currentSupports.weeklyHours ?? null,
        informationAccurate: args.payload.consent.informationAccurate,
        dataSharingConsent: args.payload.consent.dataSharingConsent,
        rawPayload: args.payload
      })
      .returning({ id: schema.submissions.id })
      .all();

    const submissionId = inserted[0].id;

    tx.insert(schema.submissionMetadata).values({
      submissionId,
      ipAddress: args.metadata.ipAddress,
      userAgent: args.metadata.userAgent,
      acceptLanguage: args.metadata.acceptLanguage,
      referer: args.metadata.referer,
      requestMethod: args.metadata.requestMethod,
      tlsVersion: args.metadata.tlsVersion,
      sessionId: args.metadata.sessionId,
      browserFingerprint: args.metadata.browserFingerprint,
      csrfTokenEcho: args.metadata.csrfTokenEcho,
      submissionTimestamp: args.metadata.submissionTimestamp
    }).run();

    for (const a of args.attachments) {
      tx.insert(schema.submissionAttachments).values({
        submissionId,
        originalFilename: a.originalFilename,
        storedPath: a.storedPath,
        sizeBytes: a.sizeBytes,
        mimeType: a.mimeType,
        sha256: a.sha256
      }).run();
    }

    return { submissionId };
  });
}

export interface WriteInvalidArgs {
  submissionUuid: string;
  rawPayload: string;
  validationErrors: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function writeInvalidSubmission(
  db: BetterSQLite3Database<typeof schema>,
  args: WriteInvalidArgs
): Promise<void> {
  await db.insert(schema.invalidSubmissions).values({
    submissionUuid: args.submissionUuid,
    rawPayload: args.rawPayload,
    validationErrors: args.validationErrors as any,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent
  }).run();
}
