import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import type { SubmissionMetadata } from './metadata';
import type { SavedAttachment } from './storage';
import type { SubmissionInput } from '../form/schema';
import { enqueueAttachments } from './ocr/enqueue';

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
				submitterSurname: args.payload.agreementSignatorysLegalLastName,
				childYouthFirstName: args.payload.childYouthsFirstName,
				childYouthMiddleNames: args.payload.childYouthsMiddleNameS || null,
				childYouthLastName: args.payload.childYouthsLegalLastName,
				childYouthDob: args.payload.childYouthsDateOfBirth,
				childYouthGender: args.payload.childYouthsGender,
				signatoryFirstName: args.payload.agreementSignatorysLegalFirstName,
				signatoryLastName: args.payload.agreementSignatorysLegalLastName,
				signatoryDob: args.payload.childYouthsDateOfBirth1,
				signatoryGender: args.payload.AgreementSigGender,
				signatoryRelationship: args.payload.AgreementSigRelationship,
				primaryPhone: args.payload.primaryPhoneNumber,
				email: args.payload.email,
				screening: args.payload.screening,
				notSubmittingReasons: args.payload.simplecheckboxes ?? null,
				assessments: args.payload.editGrid ?? null,
				primaryCareAndControl: args.payload.PrimaryCareAndControl,
				consentCollection: args.payload.iAmTheAgreementSignatory ?? null,
				consentDisclosure: args.payload.iAmTheAgreementSignatory1 ?? null,
				confirmNotSubmitting: args.payload.iAmTheAgreementSignatory2 ?? null,
				signature: args.payload.signature,
				dateSigned: args.payload.dateSigned,
				rawPayload: args.payload
			})
			.returning({ id: schema.submissions.id })
			.all();

		const submissionId = inserted[0].id;

		tx.insert(schema.submissionMetadata)
			.values({
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
			})
			.run();

		for (const a of args.attachments) {
			tx.insert(schema.submissionAttachments)
				.values({
					submissionId,
					originalFilename: a.originalFilename,
					storedPath: a.storedPath,
					sizeBytes: a.sizeBytes,
					mimeType: a.mimeType,
					sha256: a.sha256,
					assessmentIndex: a.assessmentIndex ?? null
				})
				.run();
		}

		const attachmentIds = tx
			.select({ id: schema.submissionAttachments.id })
			.from(schema.submissionAttachments)
			.where(eq(schema.submissionAttachments.submissionId, submissionId))
			.all()
			.map((r) => r.id);
		enqueueAttachments(tx, attachmentIds);

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
	await db
		.insert(schema.invalidSubmissions)
		.values({
			submissionUuid: args.submissionUuid,
			rawPayload: args.rawPayload,
			validationErrors: args.validationErrors as any,
			ipAddress: args.ipAddress,
			userAgent: args.userAgent
		})
		.run();
}
