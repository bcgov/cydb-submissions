import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
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
	'accepted',
	'rejected',
	'invalid',
	'opt-out'
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

// One row per accepted submission. Scalar leaf fields each get their own column;
// the repeatable assessments (editGrid) and the not-submitting reasons are stored as
// JSON text columns because SQLite has no native array type. We also keep the raw JSON
// payload for forensic / re-validation use.
export const submissions = sqliteTable(
	'submissions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		submissionUuid: text('submission_uuid').notNull().unique(),
		status: text('status').notNull().default('submitted'),
		// Listing/search surname — sourced from the Agreement Signatory's last name.
		submitterSurname: text('submitter_surname'),
		// Child / youth identity
		childYouthFirstName: text('child_youth_first_name').notNull(),
		childYouthMiddleNames: text('child_youth_middle_names'),
		childYouthLastName: text('child_youth_last_name').notNull(),
		childYouthDob: text('child_youth_dob').notNull(),
		childYouthGender: text('child_youth_gender').notNull(),
		// Agreement signatory identity + contact
		signatoryFirstName: text('signatory_first_name').notNull(),
		signatoryLastName: text('signatory_last_name').notNull(),
		signatoryDob: text('signatory_dob').notNull(),
		signatoryGender: text('signatory_gender').notNull(),
		signatoryRelationship: text('signatory_relationship').notNull(),
		primaryPhone: text('primary_phone').notNull(),
		email: text('email').notNull(),
		// Screening + conditional branches
		screening: text('screening').notNull(),
		notSubmittingReasons: text('not_submitting_reasons', { mode: 'json' }).$type<string[]>(),
		assessments: text('assessments', { mode: 'json' }).$type<
			Array<{
				assessmentType: string;
				completedBy: string;
				dateOfAssessment: string;
				attachmentName: string;
			}>
		>(),
		// Consent attestations
		primaryCareAndControl: integer('primary_care_and_control', { mode: 'boolean' }).notNull(),
		consentCollection: integer('consent_collection', { mode: 'boolean' }),
		consentDisclosure: integer('consent_disclosure', { mode: 'boolean' }),
		confirmNotSubmitting: integer('confirm_not_submitting', { mode: 'boolean' }),
		// Signature
		signature: text('signature').notNull(),
		dateSigned: text('date_signed').notNull(),
		rawPayload: text('raw_payload', { mode: 'json' }).notNull(),
		createdAt: text('created_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		// Null (or older than updatedAt) means this row is not yet reflected in the
		// Manticore search index. The reconciler indexes any such "dirty" row.
		searchIndexedAt: text('search_indexed_at'),
		// Decision fields — set when a submission is accepted or rejected
		decision: text('decision'),
		decisionReasons: text('decision_reasons', { mode: 'json' }).$type<string[]>(),
		decidedBy: text('decided_by'),
		decidedAt: text('decided_at'),
		levelOfNeedSummary: text('level_of_need_summary')
	},
	(t) => ({
		byStatus: index('submissions_status_idx').on(t.status),
		byCreated: index('submissions_created_idx').on(t.createdAt),
		bySurname: index('submissions_surname_idx').on(t.submitterSurname),
		bySearchIndexed: index('submissions_search_indexed_idx').on(t.searchIndexedAt),
		statusCheck: check(
			'submissions_status_check',
			sql`${t.status} IN ('submitted','OCR queued','OCR Error','OCR processed','ready for review','ready for clinician','reviewed','accepted','rejected','invalid','opt-out')`
		),
		decisionCheck: check(
			'submissions_decision_check',
			sql`${t.decision} IS NULL OR ${t.decision} IN ('accepted','rejected')`
		)
	})
);

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
	submissionTimestamp: text('submission_timestamp')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`)
});

export const submissionAttachments = sqliteTable(
	'submission_attachments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		submissionId: integer('submission_id')
			.notNull()
			.references(() => submissions.id, { onDelete: 'cascade' }),
		// Index of the assessment (editGrid row) this file belongs to; null for
		// non-grid uploads.
		assessmentIndex: integer('assessment_index'),
		originalFilename: text('original_filename').notNull(),
		storedPath: text('stored_path').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		mimeType: text('mime_type').notNull(),
		sha256: text('sha256').notNull(),
		uploadedAt: text('uploaded_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => ({
		bySubmission: index('attachments_submission_idx').on(t.submissionId)
	})
);

export const userRoles = sqliteTable(
	'user_roles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		createdAt: text('created_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => ({
		uniqByUserRole: uniqueIndex('user_roles_unique').on(t.userId, t.role),
		roleCheck: check('user_roles_role_check', sql`${t.role} IN ('admin','cfd_worker','clinician','validator')`)
	})
);

export const revokedUserRoles = sqliteTable(
	'revoked_user_roles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		reason: text('reason'),
		revokedBy: text('revoked_by').notNull(),
		revokedAt: text('revoked_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => ({
		uniqByUserRole: uniqueIndex('revoked_user_roles_unique').on(t.userId, t.role),
		byUser: index('revoked_user_roles_user_idx').on(t.userId),
		roleCheck: check(
			'revoked_user_roles_role_check',
			sql`${t.role} IN ('admin','cfd_worker','clinician','validator')`
		)
	})
);

export const rejectionReasons = sqliteTable('rejection_reasons', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	text: text('text').notNull().unique(),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	createdAt: text('created_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`)
});

export const ocrJobs = sqliteTable(
	'ocr_jobs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		attachmentId: integer('attachment_id')
			.notNull()
			.references(() => submissionAttachments.id, { onDelete: 'cascade' }),
		status: text('status').notNull().default('queued'),
		attempts: integer('attempts').notNull().default(0),
		requeueCount: integer('requeue_count').notNull().default(0),
		lastError: text('last_error'),
		nextAttemptAt: text('next_attempt_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		leasedBy: text('leased_by'),
		leasedAt: text('leased_at'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => ({
		byStatusNext: index('ocr_jobs_status_next_idx').on(t.status, t.nextAttemptAt),
		byAttachment: index('ocr_jobs_attachment_idx').on(t.attachmentId),
		statusCheck: check(
			'ocr_jobs_status_check',
			sql`${t.status} IN ('queued','processing','succeeded','failed','abandoned')`
		)
	})
);

export const ocrResults = sqliteTable('ocr_results', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	attachmentId: integer('attachment_id')
		.notNull()
		.unique()
		.references(() => submissionAttachments.id, { onDelete: 'cascade' }),
	rawText: text('raw_text').notNull(),
	pages: integer('pages'),
	modelId: text('model_id').notNull(),
	apiVersion: text('api_version').notNull(),
	processedAt: text('processed_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`)
});

export const keywordHits = sqliteTable(
	'keyword_hits',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		submissionId: integer('submission_id')
			.notNull()
			.references(() => submissions.id, { onDelete: 'cascade' }),
		attachmentId: integer('attachment_id')
			.notNull()
			.references(() => submissionAttachments.id, { onDelete: 'cascade' }),
		keyword: text('keyword').notNull(),
		count: integer('count').notNull(),
		category1: integer('category1').notNull().default(0),
		category2: integer('category2').notNull().default(0),
		category3: integer('category3').notNull().default(0),
		category4: integer('category4').notNull().default(0),
		category5: integer('category5').notNull().default(0),
		category6: integer('category6').notNull().default(0),
		category7: integer('category7').notNull().default(0),
		category8: integer('category8').notNull().default(0),
		category9: integer('category9').notNull().default(0),
		category10: integer('category10').notNull().default(0),
		category11: integer('category11').notNull().default(0),
		category12: integer('category12').notNull().default(0),
		category13: integer('category13').notNull().default(0),
		computedAt: text('computed_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => ({
		uniqByPair: uniqueIndex('keyword_hits_submission_attachment_keyword_unique').on(t.submissionId, t.keyword, t.attachmentId),
		category1_idx: index("category1_idx").on(t.category1),
		category2_idx: index("category2_idx").on(t.category2),
		category3_idx: index("category3_idx").on(t.category3),
		category4_idx: index("category4_idx").on(t.category4),
		category5_idx: index("category5_idx").on(t.category5),
		category6_idx: index("category6_idx").on(t.category6),
		category7_idx: index("category7_idx").on(t.category7),
		category8_idx: index("category8_idx").on(t.category8),
		category9_idx: index("category9_idx").on(t.category9),
		category10_idx: index("category10_idx").on(t.category10),
		category11_idx: index("category11_idx").on(t.category11),
		category12_idx: index("category12_idx").on(t.category12),
		category13_idx: index("category13_idx").on(t.category13)
	})
);

export const systemState = sqliteTable('system_state', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`)
});

// Submissions that fail server-side validation are kept here for defect review.
export const invalidSubmissions = sqliteTable('invalid_submissions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	submissionUuid: text('submission_uuid').notNull().unique(),
	rawPayload: text('raw_payload').notNull(),
	validationErrors: text('validation_errors', { mode: 'json' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	receivedAt: text('received_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
	searchIndexedAt: text('search_indexed_at'),
	resolvedAt: text('resolved_at'),
	resolvedBy: text('resolved_by'),
	resolvedNote: text('resolved_note')
});

export const submissionClaims = sqliteTable('submission_claims', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	submissionId: integer('submission_id')
	.notNull()
	.references(() => submissions.id, { onDelete: 'cascade' }),
	userId: text('user_id')
	.notNull()
	.references(() => user.id, { onDelete: 'cascade' }),
	},
	(t) => ({
		uniqByUserRole: uniqueIndex('submission_claims_unique').on(t.userId, t.submissionId),
}));

export * from './auth.schema';
