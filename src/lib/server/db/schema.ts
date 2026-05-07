import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// One row per accepted submission. Every leaf form field gets its own column,
// AND we also store the raw JSON payload for forensic / re-validation use.
// Multi-select arrays (conditions, services, assessmentTools) are stored as JSON text
// because SQLite has no native array type; this still satisfies "every field has a column."
export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionUuid: text('submission_uuid').notNull().unique(),
  status: text('status').notNull().default('submitted'),
  // Form fields — childInfo
  dateOfBirth: text('dateOfBirth'),
  primaryLanguage: text('primaryLanguage'),
  // developmentalHistory
  developmentalConcerns: integer('developmentalConcerns', { mode: 'boolean' }),
  ageOfFirstConcern: text('ageOfFirstConcern'),
  // diagnosis
  hasFormalDiagnosis: integer('hasFormalDiagnosis', { mode: 'boolean' }),
  diagnosticStatus: text('diagnosticStatus'),
  assessmentTools: text('assessmentTools', { mode: 'json' }).$type<string[]>(),
  // functionalImpact
  communication: text('communication'),
  socialInteraction: text('socialInteraction'),
  dailyLivingSkills: text('dailyLivingSkills'),
  behaviouralConcerns: text('behaviouralConcerns'),
  // coOccurringConditions
  conditions: text('conditions', { mode: 'json' }).$type<string[]>(),
  // currentSupports
  services: text('services', { mode: 'json' }).$type<string[]>(),
  weeklyHours: real('weeklyHours'),
  // consent
  informationAccurate: integer('informationAccurate', { mode: 'boolean' }).notNull(),
  dataSharingConsent: integer('dataSharingConsent', { mode: 'boolean' }).notNull(),
  rawPayload: text('raw_payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => ({
  byStatus: index('submissions_status_idx').on(t.status),
  byCreated: index('submissions_created_idx').on(t.createdAt)
}));

export const submissionMetadata = sqliteTable('submission_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' })
    .unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  acceptLanguage: text('accept_language'),
  referer: text('referer'),
  requestMethod: text('request_method'),
  tlsVersion: text('tls_version'),
  sessionId: text('session_id'),
  browserFingerprint: text('browser_fingerprint'),
  csrfTokenEcho: text('csrf_token_echo'),
  submissionTimestamp: text('submission_timestamp').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const submissionAttachments = sqliteTable('submission_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  storedPath: text('stored_path').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  mimeType: text('mime_type').notNull(),
  sha256: text('sha256').notNull(),
  uploadedAt: text('uploaded_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => ({
  bySubmission: index('attachments_submission_idx').on(t.submissionId)
}));

// Submissions that fail server-side validation are kept here for defect review.
export const invalidSubmissions = sqliteTable('invalid_submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionUuid: text('submission_uuid').notNull().unique(),
  rawPayload: text('raw_payload').notNull(),
  validationErrors: text('validation_errors', { mode: 'json' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  receivedAt: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export * from './auth.schema';
