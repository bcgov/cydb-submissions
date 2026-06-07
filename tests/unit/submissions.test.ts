import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/lib/server/db/schema';
import { writeValidSubmission, writeInvalidSubmission } from '../../src/lib/server/submissions';

function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });
	return { db, sqlite };
}

const validPayload = {
	childYouthsFirstName: 'Jordan',
	childYouthsLegalLastName: 'Smith',
	childYouthsDateOfBirth: '2015-06-01',
	childYouthsGender: 'nonBinaryPerson',
	agreementSignatorysLegalFirstName: 'Alex',
	agreementSignatorysLegalLastName: 'Smith',
	childYouthsDateOfBirth1: '1985-02-20',
	AgreementSigGender: 'womanGirl',
	AgreementSigRelationship: 'Parent',
	primaryPhoneNumber: '250-555-0100',
	email: 'alex@example.com',
	screening: 'Yes',
	editGrid: [
		{
			assessmentType: 'Pediatrician Report or Assessment',
			completedBy: 'Pediatrician',
			dateOfAssessment: '2024-09-10',
			attachmentName: 'a.pdf'
		}
	],
	PrimaryCareAndControl: true,
	iAmTheAgreementSignatory: true,
	iAmTheAgreementSignatory1: true,
	signature: 'data:image/png;base64,AAAA',
	dateSigned: '2026-06-01'
} as const;

const meta = {
	ipAddress: '203.0.113.7',
	userAgent: 'UA',
	acceptLanguage: 'en',
	referer: null,
	requestMethod: 'POST',
	tlsVersion: 'https',
	sessionId: null,
	browserFingerprint: 'fp',
	csrfTokenEcho: 'tok',
	submissionTimestamp: '2026-05-06T10:00:00Z'
};

describe('writeValidSubmission', () => {
	it('inserts submission, metadata, and attachments atomically', async () => {
		const { db, sqlite } = freshDb();
		const r = await writeValidSubmission(db, {
			submissionUuid: 'sub_1',
			payload: validPayload as any,
			metadata: meta,
			attachments: [
				{
					originalFilename: 'a.pdf',
					storedPath: '/x/a.pdf',
					sizeBytes: 10,
					mimeType: 'application/pdf',
					sha256: 'abc',
					assessmentIndex: 0
				},
				{
					originalFilename: 'b.pdf',
					storedPath: '/x/b.pdf',
					sizeBytes: 20,
					mimeType: 'application/pdf',
					sha256: 'def',
					assessmentIndex: 1
				}
			]
		});
		expect(r.submissionId).toBeGreaterThan(0);
		const subs = sqlite.prepare('SELECT count(*) AS c FROM submissions').get() as { c: number };
		const md = sqlite.prepare('SELECT count(*) AS c FROM submission_metadata').get() as {
			c: number;
		};
		const att = sqlite.prepare('SELECT count(*) AS c FROM submission_attachments').get() as {
			c: number;
		};
		expect(subs.c).toBe(1);
		expect(md.c).toBe(1);
		expect(att.c).toBe(2);
		const idx = sqlite
			.prepare('SELECT assessment_index AS i FROM submission_attachments ORDER BY assessment_index')
			.all() as Array<{ i: number }>;
		expect(idx.map((r) => r.i)).toEqual([0, 1]);
		const sub = sqlite
			.prepare('SELECT submitter_surname AS s, screening FROM submissions')
			.get() as any;
		expect(sub.s).toBe('Smith');
		expect(sub.screening).toBe('Yes');
	});

	it('rolls back on attachment failure', async () => {
		const { db, sqlite } = freshDb();
		await expect(
			writeValidSubmission(db, {
				submissionUuid: 'sub_2',
				payload: validPayload as any,
				metadata: meta,
				attachments: [
					{
						originalFilename: 'a.pdf',
						storedPath: null as any,
						sizeBytes: 10,
						mimeType: 'application/pdf',
						sha256: 'abc'
					}
				]
			})
		).rejects.toThrow();
		expect((sqlite.prepare('SELECT count(*) AS c FROM submissions').get() as any).c).toBe(0);
	});
});

describe('writeInvalidSubmission', () => {
	it('records errors and raw body', async () => {
		const { db, sqlite } = freshDb();
		await writeInvalidSubmission(db, {
			submissionUuid: 'sub_3',
			rawPayload: '{"bad":1}',
			validationErrors: [{ path: ['childInfo', 'dateOfBirth'], message: 'required' }],
			ipAddress: '1.1.1.1',
			userAgent: 'UA'
		});
		const r = sqlite.prepare('SELECT count(*) AS c FROM invalid_submissions').get() as {
			c: number;
		};
		expect(r.c).toBe(1);
	});
});
