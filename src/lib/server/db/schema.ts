import { sqliteTable, text, integer, real, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema';

export const SUBMISSION_STATUSES = [
  'submitted',
  'OCR queued',
  'OCR Error',
  'OCR processed',
  'ready for review',
  'ready for clinician',
  'reviewed',
  'invalid'
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

// One row per accepted submission. Every leaf form field gets its own column,
// AND we also store the raw JSON payload for forensic / re-validation use.
// Multi-select arrays (conditions, services, assessmentTools) are stored as JSON text
// because SQLite has no native array type; this still satisfies "every field has a column."
export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionUuid: text('submission_uuid').notNull().unique(),
  status: text('status').notNull().default('submitted'),
  submitterSurname: text('submitter_surname'),
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
  byCreated: index('submissions_created_idx').on(t.createdAt),
  bySurname: index('submissions_surname_idx').on(t.submitterSurname),
  statusCheck: check(
    'submissions_status_check',
    sql`${t.status} IN ('submitted','OCR queued','OCR Error','OCR processed','ready for review','ready for clinician','reviewed','invalid')`
  )
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

export const userRoles = sqliteTable('user_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => ({
  uniqByUserRole: uniqueIndex('user_roles_unique').on(t.userId, t.role),
  roleCheck: check(
    'user_roles_role_check',
    sql`${t.role} IN ('admin','cfd_worker','clinician')`
  )
}));

export const ocrJobs = sqliteTable('ocr_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attachmentId: integer('attachment_id').notNull()
    .references(() => submissionAttachments.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  requeueCount: integer('requeue_count').notNull().default(0),
  lastError: text('last_error'),
  nextAttemptAt: text('next_attempt_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  leasedBy: text('leased_by'),
  leasedAt: text('leased_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => ({
  byStatusNext: index('ocr_jobs_status_next_idx').on(t.status, t.nextAttemptAt),
  byAttachment: index('ocr_jobs_attachment_idx').on(t.attachmentId),
  statusCheck: check(
    'ocr_jobs_status_check',
    sql`${t.status} IN ('queued','processing','succeeded','failed','abandoned')`
  )
}));

export const ocrResults = sqliteTable('ocr_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attachmentId: integer('attachment_id').notNull().unique()
    .references(() => submissionAttachments.id, { onDelete: 'cascade' }),
  rawText: text('raw_text').notNull(),
  pages: integer('pages'),
  modelId: text('model_id').notNull(),
  apiVersion: text('api_version').notNull(),
  processedAt: text('processed_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const keywordHits = sqliteTable('keyword_hits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id').notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  keyword: text('keyword').notNull(),
  count: integer('count').notNull(),
  computedAt: text('computed_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => ({
  uniqByPair: uniqueIndex('keyword_hits_submission_keyword_unique').on(t.submissionId, t.keyword)
}));

export const systemState = sqliteTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});

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
