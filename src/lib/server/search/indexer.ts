import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { buildSearchDocument, type SubmissionRowForIndex } from './document';
import type { SearchClient } from './types';

type Db = BetterSQLite3Database<typeof schema>;

/** Concatenated OCR text across all of a submission's attachments. */
function ocrTextFor(db: Db, submissionId: number): string {
	const rows = db
		.select({ text: schema.ocrResults.rawText })
		.from(schema.ocrResults)
		.innerJoin(schema.submissionAttachments, eq(schema.submissionAttachments.id, schema.ocrResults.attachmentId))
		.where(eq(schema.submissionAttachments.submissionId, submissionId))
		.all();
	return rows.map((r) => r.text).join('\n\n');
}

function metadataTextFor(db: Db, submissionId: number): string {
	const m = db.select().from(schema.submissionMetadata).where(eq(schema.submissionMetadata.submissionId, submissionId)).get();
	if (!m) return '';
	// HTTP request fields useful for investigator search; requestMethod (always POST),
	// session IDs, fingerprints and CSRF echoes are omitted as non-searchable noise.
	return [m.userAgent, m.acceptLanguage, m.referer, m.ipAddress, m.tlsVersion].filter(Boolean).join(' ');
}

/**
 * Build and push the index document for one submission, then stamp
 * search_indexed_at. Returns false if the submission no longer exists.
 * Throws on index-client failure (callers decide whether to swallow).
 */
export async function indexSubmission(db: Db, client: SearchClient, submissionId: number): Promise<boolean> {
	const row = db
		.select({
			id: schema.submissions.id,
			submissionUuid: schema.submissions.submissionUuid,
			status: schema.submissions.status,
			submitterSurname: schema.submissions.submitterSurname,
			dateOfBirth: schema.submissions.dateOfBirth,
			primaryLanguage: schema.submissions.primaryLanguage,
			developmentalConcerns: schema.submissions.developmentalConcerns,
			ageOfFirstConcern: schema.submissions.ageOfFirstConcern,
			hasFormalDiagnosis: schema.submissions.hasFormalDiagnosis,
			diagnosticStatus: schema.submissions.diagnosticStatus,
			assessmentTools: schema.submissions.assessmentTools,
			communication: schema.submissions.communication,
			socialInteraction: schema.submissions.socialInteraction,
			dailyLivingSkills: schema.submissions.dailyLivingSkills,
			behaviouralConcerns: schema.submissions.behaviouralConcerns,
			conditions: schema.submissions.conditions,
			services: schema.submissions.services,
			weeklyHours: schema.submissions.weeklyHours,
			createdAt: schema.submissions.createdAt
		})
		.from(schema.submissions)
		.where(eq(schema.submissions.id, submissionId))
		.get();
	if (!row) return false;

	const doc = buildSearchDocument(row, ocrTextFor(db, submissionId), metadataTextFor(db, submissionId));
	await client.replaceDoc(doc);

	db.update(schema.submissions)
		.set({ searchIndexedAt: sql`CURRENT_TIMESTAMP` })
		.where(eq(schema.submissions.id, submissionId))
		.run();
	return true;
}

export async function deleteSubmission(client: SearchClient, submissionId: number): Promise<void> {
	await client.deleteDoc(submissionId);
}
