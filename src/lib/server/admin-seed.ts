import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
	submissions,
	submissionMetadata,
	submissionAttachments,
	invalidSubmissions
} from './db/schema';
import type { DrizzleDb } from './roles';

const TINY_PDF = Buffer.from(
	'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000098 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n148\n%%EOF\n'
);
const TINY_PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63600000000200015e8d8d010000000049454e44ae426082',
	'hex'
);

const USER_AGENTS = [
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4) Safari/17.4',
	'Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Mobile/15E148'
];
const IPS = ['203.0.113.10', '198.51.100.42', '192.0.2.88', '203.0.113.55'];

interface MockAttachment {
	name: string;
	mime: string;
	bytes: Buffer;
	assessmentIndex?: number;
}

interface AssessmentEntry {
	assessmentType: string;
	completedBy: string;
	dateOfAssessment: string;
	attachmentName: string;
}

interface MockSubmission {
	uuid: string;
	status: string;
	createdAt: string;
	childFirstName: string;
	childMiddleNames?: string;
	childLastName: string;
	childDob: string;
	childGender: 'manBoy' | 'nonBinaryPerson' | 'womanGirl' | 'preferNotToAnswerUnknown';
	signatoryFirstName: string;
	signatoryLastName: string;
	signatoryDob: string;
	signatoryGender: 'manBoy' | 'nonBinaryPerson' | 'womanGirl' | 'preferNotToAnswerUnknown';
	signatoryRelationship: string;
	primaryPhone: string;
	email: string;
	screening: 'Yes' | 'No';
	notSubmittingReasons?: string[];
	assessments?: AssessmentEntry[];
	primaryCareAndControl: boolean;
	consentCollection?: boolean;
	consentDisclosure?: boolean;
	confirmNotSubmitting?: boolean;
	signature: string;
	dateSigned: string;
	attachments?: MockAttachment[];
	invalid?: boolean;
	invalidReason?: string;
}

// 10 valid + 2 invalid = 12 MOCKS total.
// Valid rows have 9 attachments total:
//   Adams(1), Brown(2), Chen(1), Davis(1), Edwards(0), Foster(1), Gomez(0), Harrison(0), Iyer(2), Liu(1) = 9
const MOCKS: MockSubmission[] = [
	{
		uuid: 'mock-adams-2026-04-02',
		status: 'submitted',
		createdAt: '2026-04-02T09:14:22Z',
		childFirstName: 'Oliver',
		childLastName: 'Adams',
		childDob: '2015-06-01',
		childGender: 'manBoy',
		signatoryFirstName: 'Patricia',
		signatoryLastName: 'Adams',
		signatoryDob: '1985-02-20',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '604-555-0101',
		email: 'padams@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Pediatrician Report or Assessment',
				completedBy: 'Pediatrician',
				dateOfAssessment: '2025-11-10',
				attachmentName: 'assessment-report.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Patricia Adams',
		dateSigned: '2026-04-02',
		attachments: [
			{
				name: 'assessment-report.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},
	{
		uuid: 'mock-brown-2026-04-04',
		status: 'OCR queued',
		createdAt: '2026-04-04T15:02:08Z',
		childFirstName: 'Emma',
		childLastName: 'Brown',
		childDob: '2016-03-14',
		childGender: 'womanGirl',
		signatoryFirstName: 'David',
		signatoryLastName: 'Brown',
		signatoryDob: '1982-07-11',
		signatoryGender: 'manBoy',
		signatoryRelationship: 'Parent',
		primaryPhone: '778-555-0202',
		email: 'dbrown@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Speech and Language Pathology Report or Assessment',
				completedBy: 'Speech and Language Pathologist',
				dateOfAssessment: '2025-08-05',
				attachmentName: 'iep-2025.pdf'
			},
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-10-22',
				attachmentName: 'photo.png'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'David Brown',
		dateSigned: '2026-04-04',
		attachments: [
			{ name: 'iep-2025.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 0 },
			{ name: 'photo.png', mime: 'image/png', bytes: TINY_PNG, assessmentIndex: 1 }
		]
	},
	{
		uuid: 'mock-chen-2026-04-07',
		status: 'OCR processed',
		createdAt: '2026-04-07T11:38:50Z',
		childFirstName: 'Mei',
		childLastName: 'Chen',
		childDob: '2014-09-20',
		childGender: 'womanGirl',
		signatoryFirstName: 'Wei',
		signatoryLastName: 'Chen',
		signatoryDob: '1979-04-30',
		signatoryGender: 'manBoy',
		signatoryRelationship: 'Parent',
		primaryPhone: '250-555-0303',
		email: 'wchen@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-06-18',
				attachmentName: 'bcaan-report.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Wei Chen',
		dateSigned: '2026-04-07',
		attachments: [
			{ name: 'bcaan-report.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 0 }
		]
	},
	{
		uuid: 'mock-davis-2026-04-10',
		status: 'OCR Error',
		createdAt: '2026-04-10T08:21:00Z',
		childFirstName: 'Liam',
		childLastName: 'Davis',
		childDob: '2017-01-07',
		childGender: 'manBoy',
		signatoryFirstName: 'Sandra',
		signatoryLastName: 'Davis',
		signatoryDob: '1988-11-03',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '604-555-0404',
		email: 'sdavis@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Pediatrician Report or Assessment',
				completedBy: 'Pediatrician',
				dateOfAssessment: '2025-09-14',
				attachmentName: 'corrupted-scan.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Sandra Davis',
		dateSigned: '2026-04-10',
		attachments: [
			{ name: 'corrupted-scan.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 0 }
		]
	},
	{
		uuid: 'mock-edwards-2026-04-12',
		status: 'ready for review',
		createdAt: '2026-04-12T13:47:15Z',
		childFirstName: 'Avery',
		childLastName: 'Edwards',
		childDob: '2013-11-25',
		childGender: 'nonBinaryPerson',
		signatoryFirstName: 'Jordan',
		signatoryLastName: 'Edwards',
		signatoryDob: '1983-05-16',
		signatoryGender: 'preferNotToAnswerUnknown',
		signatoryRelationship: 'Guardian',
		primaryPhone: '778-555-0505',
		email: 'jedwards@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-07-03',
				attachmentName: 'bcaan-full-report.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Jordan Edwards',
		dateSigned: '2026-04-12'
		// No attachments on disk (0 files)
	},
	{
		uuid: 'mock-foster-2026-04-14',
		status: 'ready for clinician',
		createdAt: '2026-04-14T16:55:33Z',
		childFirstName: 'Noah',
		childLastName: 'Foster',
		childDob: '2016-07-19',
		childGender: 'manBoy',
		signatoryFirstName: 'Rachel',
		signatoryLastName: 'Foster',
		signatoryDob: '1986-09-28',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '250-555-0606',
		email: 'rfoster@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Speech and Language Pathology Report or Assessment',
				completedBy: 'Speech and Language Pathologist',
				dateOfAssessment: '2026-01-15',
				attachmentName: 'clinician-summary.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Rachel Foster',
		dateSigned: '2026-04-14',
		attachments: [
			{
				name: 'clinician-summary.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},
	{
		uuid: 'mock-gomez-2026-04-16',
		status: 'reviewed',
		createdAt: '2026-04-16T10:08:41Z',
		childFirstName: 'Sofia',
		childLastName: 'Gomez',
		childDob: '2014-04-30',
		childGender: 'womanGirl',
		signatoryFirstName: 'Carlos',
		signatoryLastName: 'Gomez',
		signatoryDob: '1980-12-22',
		signatoryGender: 'manBoy',
		signatoryRelationship: 'Parent',
		primaryPhone: '604-555-0707',
		email: 'cgomez@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Pediatrician Report or Assessment',
				completedBy: 'Pediatrician',
				dateOfAssessment: '2025-05-20',
				attachmentName: 'gomez-pediatrician.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Carlos Gomez',
		dateSigned: '2026-04-16'
		// No attachments on disk
	},
	{
		uuid: 'mock-harrison-2026-04-18',
		status: 'submitted',
		createdAt: '2026-04-18T07:12:05Z',
		childFirstName: 'Isla',
		childLastName: 'Harrison',
		childDob: '2018-11-03',
		childGender: 'womanGirl',
		signatoryFirstName: 'Michael',
		signatoryLastName: 'Harrison',
		signatoryDob: '1987-06-14',
		signatoryGender: 'manBoy',
		signatoryRelationship: 'Parent',
		primaryPhone: '778-555-0808',
		email: 'mharrison@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Speech and Language Pathology Report or Assessment',
				completedBy: 'Speech and Language Pathologist',
				dateOfAssessment: '2025-10-08',
				attachmentName: 'harrison-slp.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Michael Harrison',
		dateSigned: '2026-04-18'
		// No attachments on disk
	},
	{
		uuid: 'mock-iyer-2026-04-20',
		status: 'submitted',
		createdAt: '2026-04-20T14:33:12Z',
		childFirstName: 'Arjun',
		childLastName: 'Iyer',
		childDob: '2015-08-27',
		childGender: 'manBoy',
		signatoryFirstName: 'Priya',
		signatoryLastName: 'Iyer',
		signatoryDob: '1984-03-09',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '250-555-0909',
		email: 'piyer@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Pediatrician Report or Assessment',
				completedBy: 'Pediatrician',
				dateOfAssessment: '2025-04-17',
				attachmentName: 'pediatrician-letter.pdf'
			},
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-11-30',
				attachmentName: 'iep-summary.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Priya Iyer',
		dateSigned: '2026-04-20',
		attachments: [
			{
				name: 'pediatrician-letter.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			},
			{ name: 'iep-summary.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 1 }
		]
	},
	{
		uuid: 'mock-liu-2026-04-26',
		status: 'submitted',
		createdAt: '2026-04-26T12:00:00Z',
		childFirstName: 'Mei-Lin',
		childLastName: 'Liu',
		childDob: '2017-05-12',
		childGender: 'womanGirl',
		signatoryFirstName: 'Fang',
		signatoryLastName: 'Liu',
		signatoryDob: '1983-01-17',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '604-555-1212',
		email: 'fliu@example.com',
		screening: 'Yes',
		assessments: [
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-03-11',
				attachmentName: 'multidisciplinary-report.pdf'
			}
		],
		primaryCareAndControl: true,
		consentCollection: true,
		consentDisclosure: true,
		signature: 'Fang Liu',
		dateSigned: '2026-04-26',
		attachments: [
			{
				name: 'multidisciplinary-report.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},
	// Invalid submissions (go to invalid_submissions table)
	{
		uuid: 'mock-johnson-2026-04-22',
		status: 'submitted',
		createdAt: '2026-04-22T09:48:00Z',
		childFirstName: 'Tyler',
		childLastName: 'Johnson',
		childDob: '2018-08-30',
		childGender: 'manBoy',
		signatoryFirstName: 'Karen',
		signatoryLastName: 'Johnson',
		signatoryDob: '1981-08-25',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '604-555-1010',
		email: 'kjohnson@example.com',
		screening: 'Yes',
		primaryCareAndControl: true,
		signature: 'Karen Johnson',
		dateSigned: '2026-04-22',
		invalid: true,
		invalidReason: 'Mocked validation failure'
	},
	{
		uuid: 'mock-kumar-2026-04-24',
		status: 'submitted',
		createdAt: '2026-04-24T18:25:30Z',
		childFirstName: 'Future',
		childLastName: 'Kumar',
		childDob: '2099-01-01',
		childGender: 'womanGirl',
		signatoryFirstName: 'Raj',
		signatoryLastName: 'Kumar',
		signatoryDob: '1975-10-05',
		signatoryGender: 'manBoy',
		signatoryRelationship: 'Parent',
		primaryPhone: '778-555-1111',
		email: 'rkumar@example.com',
		screening: 'Yes',
		primaryCareAndControl: true,
		signature: 'Raj Kumar',
		dateSigned: '2026-04-24',
		invalid: true,
		invalidReason: 'Date of birth cannot be in the future'
	}
];

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export interface SeedResult {
	submissions: number;
	invalid: number;
	attachments: number;
}

export async function seedMockSubmissions(opts: {
	db: DrizzleDb;
	attachmentsDir: string;
}): Promise<SeedResult> {
	await clearAllSubmissions(opts);

	let attachmentCount = 0;
	let validCount = 0;
	let invalidCount = 0;

	for (const m of MOCKS) {
		if (m.invalid) {
			await opts.db.insert(invalidSubmissions).values({
				submissionUuid: m.uuid,
				rawPayload: JSON.stringify({
					childYouthFirstName: m.childFirstName,
					childYouthLastName: m.childLastName,
					childYouthDob: m.childDob,
					screening: m.screening
				}),
				validationErrors: [
					{ path: ['childYouthDob'], message: m.invalidReason ?? 'Mocked failure' }
				],
				ipAddress: pick(IPS),
				userAgent: pick(USER_AGENTS),
				receivedAt: m.createdAt
			});
			invalidCount += 1;
			continue;
		}

		const rawPayload = {
			childYouthFirstName: m.childFirstName,
			childYouthMiddleNames: m.childMiddleNames ?? null,
			childYouthLastName: m.childLastName,
			childYouthDob: m.childDob,
			childYouthGender: m.childGender,
			signatoryFirstName: m.signatoryFirstName,
			signatoryLastName: m.signatoryLastName,
			signatoryDob: m.signatoryDob,
			signatoryGender: m.signatoryGender,
			signatoryRelationship: m.signatoryRelationship,
			primaryPhone: m.primaryPhone,
			email: m.email,
			screening: m.screening,
			notSubmittingReasons: m.notSubmittingReasons ?? null,
			assessments: m.assessments ?? null,
			primaryCareAndControl: m.primaryCareAndControl,
			consentCollection: m.consentCollection ?? null,
			consentDisclosure: m.consentDisclosure ?? null,
			confirmNotSubmitting: m.confirmNotSubmitting ?? null,
			signature: m.signature,
			dateSigned: m.dateSigned
		};

		const inserted = await opts.db
			.insert(submissions)
			.values({
				submissionUuid: m.uuid,
				status: m.status,
				submitterSurname: m.signatoryLastName,
				childYouthFirstName: m.childFirstName,
				childYouthMiddleNames: m.childMiddleNames,
				childYouthLastName: m.childLastName,
				childYouthDob: m.childDob,
				childYouthGender: m.childGender,
				signatoryFirstName: m.signatoryFirstName,
				signatoryLastName: m.signatoryLastName,
				signatoryDob: m.signatoryDob,
				signatoryGender: m.signatoryGender,
				signatoryRelationship: m.signatoryRelationship,
				primaryPhone: m.primaryPhone,
				email: m.email,
				screening: m.screening,
				notSubmittingReasons: m.notSubmittingReasons,
				assessments: m.assessments,
				primaryCareAndControl: m.primaryCareAndControl,
				consentCollection: m.consentCollection,
				consentDisclosure: m.consentDisclosure,
				confirmNotSubmitting: m.confirmNotSubmitting,
				signature: m.signature,
				dateSigned: m.dateSigned,
				rawPayload,
				createdAt: m.createdAt,
				updatedAt: m.createdAt
			})
			.returning({ id: submissions.id });
		const submissionId = inserted[0].id;
		validCount += 1;

		await opts.db.insert(submissionMetadata).values({
			submissionId,
			ipAddress: pick(IPS),
			userAgent: pick(USER_AGENTS),
			acceptLanguage: 'en-CA,en;q=0.9',
			referer: 'https://example.gov.bc.ca/',
			requestMethod: 'POST',
			tlsVersion: 'TLSv1.3',
			sessionId: randomBytes(8).toString('hex'),
			browserFingerprint: randomBytes(16).toString('hex'),
			csrfTokenEcho: randomBytes(16).toString('hex'),
			submissionTimestamp: m.createdAt
		});

		if (m.attachments?.length) {
			const dir = path.resolve(opts.attachmentsDir, m.uuid);
			rmSync(dir, { recursive: true, force: true });
			mkdirSync(dir, { recursive: true });
			for (const a of m.attachments) {
				const stored = path.join(dir, a.name);
				writeFileSync(stored, a.bytes);
				const sha = createHash('sha256').update(a.bytes).digest('hex');
				await opts.db.insert(submissionAttachments).values({
					submissionId,
					assessmentIndex: a.assessmentIndex,
					originalFilename: a.name,
					storedPath: stored,
					sizeBytes: a.bytes.length,
					mimeType: a.mime,
					sha256: sha,
					uploadedAt: m.createdAt
				});
				attachmentCount += 1;
			}
		}
	}

	return { submissions: validCount, invalid: invalidCount, attachments: attachmentCount };
}

export async function clearAllSubmissions(opts: {
	db: DrizzleDb;
	attachmentsDir: string;
}): Promise<{ cleared: true }> {
	await opts.db.run(sql`DELETE FROM submission_attachments`);
	await opts.db.run(sql`DELETE FROM submission_metadata`);
	await opts.db.run(sql`DELETE FROM submissions`);
	await opts.db.run(sql`DELETE FROM invalid_submissions`);

	if (existsSync(opts.attachmentsDir)) {
		for (const entry of readdirSync(opts.attachmentsDir)) {
			rmSync(path.join(opts.attachmentsDir, entry), { recursive: true, force: true });
		}
	}

	return { cleared: true };
}
