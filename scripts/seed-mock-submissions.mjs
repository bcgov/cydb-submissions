#!/usr/bin/env node
// Seed ~12 mock submissions in varied states + a handful of attachments.
// Idempotent re: identity: re-running wipes and re-seeds the four submission tables.
// Runs against process.env.DATABASE_URL (default: local.db) and writes
// attachment files under process.env.ATTACHMENTS_DIR (default: ./attachments).
//
// Usage:
//   node scripts/seed-mock-submissions.mjs
//   DATABASE_URL=/data/local.db node scripts/seed-mock-submissions.mjs
//   npm run seed:mock

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';

const dbUrl = process.env.DATABASE_URL ?? 'local.db';
const attachmentsDir = process.env.ATTACHMENTS_DIR ?? './attachments';

const TINY_PDF = Buffer.from(
	'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000098 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n148\n%%EOF\n'
);
const TINY_PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63600000000200015e8d8d010000000049454e44ae426082',
	'hex'
);

// Valid assessment type → professional pairs
const ASSESSMENT_TYPES = [
	{
		assessmentType: 'Pediatrician Report or Assessment',
		completedBy: 'Pediatrician'
	},
	{
		assessmentType: 'Speech and Language Pathology Report or Assessment',
		completedBy: 'Speech and Language Pathologist'
	},
	{
		assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
		completedBy: 'BCAAN (British Columbia Autism Assessment Network)'
	}
];

// Valid gender enum values
const GENDERS = ['manBoy', 'nonBinaryPerson', 'womanGirl', 'preferNotToAnswerUnknown'];

// Realistic OCR text per attachment, keyed by filename. The search indexer
// (src/lib/server/search/indexer.ts:ocrTextFor) joins ocr_results.raw_text into
// the Manticore `ocr_text` field, so this is what makes document-content search
// testable. Only attachments on submissions whose status implies OCR has
// completed (OCR processed → reviewed) get text — mirroring the real pipeline.
// Terms are deliberately mixed: shared (ADOS-2, BCAAN, Autism Spectrum Disorder,
// Vineland, IEP) for multi-hit relevance ranking, and unique (articulation,
// ADHD, hyperactivity) for precise single-result queries + highlighting.
const OCR_TEXT = {
	'bcaan-assessment.pdf':
		'British Columbia Autism Assessment Network (BCAAN) Diagnostic Report. ADOS-2 ' +
		'administered, Module 3. The child presents with persistent deficits in social ' +
		'communication and restricted, repetitive patterns of behaviour consistent with ' +
		'Autism Spectrum Disorder (DSM-5 299.00). Vineland-3 adaptive behaviour composite ' +
		'standard score 72. Recommends speech-language therapy and occupational therapy. ' +
		'Diagnosing clinician: Dr. A. Patel, Registered Psychologist.',
	'bcaan-full-report.pdf':
		'BCAAN Autism Spectrum Disorder Assessment. ADOS-2 Module 4 and ADI-R completed. ' +
		'The youth meets diagnostic criteria for Autism Spectrum Disorder requiring ' +
		'substantial support (Level 2). Cognitive assessment WISC-V full scale IQ 88. ' +
		'Sensory sensitivities to noise and texture noted. Recommends a structured ' +
		'behavioural intervention plan and an updated IEP review at school.',
	'clinician-slp-summary.pdf':
		'Speech-Language Pathology Assessment Summary. The child presents with a moderate ' +
		'expressive language delay and articulation errors affecting the /r/ and /s/ ' +
		'phonemes. CELF-5 core language score 78. Receptive language is within normal ' +
		'limits. Recommends weekly speech therapy targeting expressive vocabulary and ' +
		'phonological awareness. Assessed by R. Singh, Speech-Language Pathologist (SLP).',
	'gomez-pediatrician.pdf':
		'Pediatric Developmental Assessment. Growth parameters within normal range; gross ' +
		'and fine motor skills age-appropriate. Concerns noted regarding attention and ' +
		'hyperactivity; screening positive for ADHD features. Referred for a ' +
		'psychoeducational evaluation. Examined by Dr. L. Nguyen, Pediatrician, ' +
		"BC Children's Hospital."
};

// Identifiers recorded on each seeded OCR result (mirrors the stub OCR provider).
const OCR_MODEL_ID = 'stub-ocr';
const OCR_API_VERSION = 'seed-v1';

/**
 * @typedef {{
 *   assessmentType: string;
 *   completedBy: string;
 *   dateOfAssessment: string;
 *   attachmentName: string;
 * }} AssessmentEntry
 *
 * @typedef {{
 *   uuid: string;
 *   status: string;
 *   createdAt: string;
 *   childFirstName: string;
 *   childMiddleNames?: string;
 *   childLastName: string;
 *   childDob: string;
 *   childGender: string;
 *   signatoryFirstName: string;
 *   signatoryLastName: string;
 *   signatoryDob: string;
 *   signatoryGender: string;
 *   signatoryRelationship: string;
 *   primaryPhone: string;
 *   email: string;
 *   screening: 'Yes' | 'No';
 *   notSubmittingReasons?: string[];
 *   assessments?: AssessmentEntry[];
 *   primaryCareAndControl: 0 | 1;
 *   consentCollection?: 0 | 1;
 *   consentDisclosure?: 0 | 1;
 *   confirmNotSubmitting?: 0 | 1;
 *   signature: string;
 *   dateSigned: string;
 *   attachments?: Array<{ name: string; mime: string; bytes: Buffer; assessmentIndex: number }>;
 * }} Mock
 */

/** @type {Mock[]} */
const mocks = [
	// submitted — Adams child, Pediatrician assessment
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
				attachmentName: 'pediatrician-report.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Patricia Adams',
		dateSigned: '2026-04-02',
		attachments: [
			{
				name: 'pediatrician-report.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},

	// OCR queued — Brown child, Speech + Autism assessments
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
				attachmentName: 'slp-report.pdf'
			},
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-10-22',
				attachmentName: 'bcaan-report.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'David Brown',
		dateSigned: '2026-04-04',
		attachments: [
			{ name: 'slp-report.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 0 },
			{ name: 'bcaan-report.pdf', mime: 'image/png', bytes: TINY_PNG, assessmentIndex: 1 }
		]
	},

	// OCR processed — Chen child, Autism assessment
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
				attachmentName: 'bcaan-assessment.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Wei Chen',
		dateSigned: '2026-04-07',
		attachments: [
			{ name: 'bcaan-assessment.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 0 }
		]
	},

	// OCR Error — Davis child, Pediatrician + Speech assessments
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
				attachmentName: 'pediatrician-letter.pdf'
			},
			{
				assessmentType: 'Speech and Language Pathology Report or Assessment',
				completedBy: 'Speech and Language Pathologist',
				dateOfAssessment: '2025-12-01',
				attachmentName: 'corrupted-slp-scan.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Sandra Davis',
		dateSigned: '2026-04-10',
		attachments: [
			{
				name: 'pediatrician-letter.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			},
			{
				name: 'corrupted-slp-scan.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 1
			}
		]
	},

	// ready for review — Edwards child, Autism assessment, non-binary
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
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Jordan Edwards',
		dateSigned: '2026-04-12',
		attachments: [
			{
				name: 'bcaan-full-report.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},

	// ready for clinician — Foster child, Speech assessment
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
				attachmentName: 'clinician-slp-summary.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Rachel Foster',
		dateSigned: '2026-04-14',
		attachments: [
			{
				name: 'clinician-slp-summary.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},

	// reviewed — Gomez child, Pediatrician assessment, no attachments
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
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Carlos Gomez',
		dateSigned: '2026-04-16',
		attachments: [
			{
				name: 'gomez-pediatrician.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			}
		]
	},

	// submitted — Harrison child, Speech assessment
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
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Michael Harrison',
		dateSigned: '2026-04-18',
		attachments: [
			{ name: 'harrison-slp.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 0 }
		]
	},

	// submitted — Iyer child, Pediatrician + Autism assessments
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
				attachmentName: 'iyer-pediatrician.pdf'
			},
			{
				assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
				completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
				dateOfAssessment: '2025-11-30',
				attachmentName: 'iyer-bcaan.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Priya Iyer',
		dateSigned: '2026-04-20',
		attachments: [
			{
				name: 'iyer-pediatrician.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			},
			{ name: 'iyer-bcaan.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 1 }
		]
	},

	// screening=No — Johnson, not submitting (prefer to apply directly + no info)
	{
		uuid: 'mock-johnson-2026-04-22',
		status: 'submitted',
		createdAt: '2026-04-22T09:48:00Z',
		childFirstName: 'Tyler',
		childLastName: 'Johnson',
		childDob: '2010-02-18',
		childGender: 'manBoy',
		signatoryFirstName: 'Karen',
		signatoryLastName: 'Johnson',
		signatoryDob: '1981-08-25',
		signatoryGender: 'womanGirl',
		signatoryRelationship: 'Parent',
		primaryPhone: '604-555-1010',
		email: 'kjohnson@example.com',
		screening: 'No',
		notSubmittingReasons: [
			'iPreferToApplyDirectlyToTheBenefitWhenThatProcessIsAvailable',
			'iDoNotHaveAnyAssessmentInformation'
		],
		primaryCareAndControl: 1,
		confirmNotSubmitting: 1,
		signature: 'Karen Johnson',
		dateSigned: '2026-04-22'
	},

	// screening=No — Kumar, prefer not to say + nearly 19
	{
		uuid: 'mock-kumar-2026-04-24',
		status: 'submitted',
		createdAt: '2026-04-24T18:25:30Z',
		childFirstName: 'Anika',
		childLastName: 'Kumar',
		childDob: '2008-04-10',
		childGender: 'womanGirl',
		signatoryFirstName: 'Raj',
		signatoryLastName: 'Kumar',
		signatoryDob: '1975-10-05',
		signatoryGender: 'manBoy',
		signatoryRelationship: 'Parent',
		primaryPhone: '778-555-1111',
		email: 'rkumar@example.com',
		screening: 'No',
		notSubmittingReasons: [
			'myChildOrYouthWillBeNearly19WhenTheBenefitIsIntroduced',
			'iPreferNotToSay'
		],
		primaryCareAndControl: 1,
		confirmNotSubmitting: 1,
		signature: 'Raj Kumar',
		dateSigned: '2026-04-24'
	},

	// submitted — Liu child, Autism + Speech assessments
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
				attachmentName: 'liu-bcaan-report.pdf'
			},
			{
				assessmentType: 'Speech and Language Pathology Report or Assessment',
				completedBy: 'Speech and Language Pathologist',
				dateOfAssessment: '2026-02-07',
				attachmentName: 'liu-slp-report.pdf'
			}
		],
		primaryCareAndControl: 1,
		consentCollection: 1,
		consentDisclosure: 1,
		signature: 'Fang Liu',
		dateSigned: '2026-04-26',
		attachments: [
			{
				name: 'liu-bcaan-report.pdf',
				mime: 'application/pdf',
				bytes: TINY_PDF,
				assessmentIndex: 0
			},
			{ name: 'liu-slp-report.pdf', mime: 'application/pdf', bytes: TINY_PDF, assessmentIndex: 1 }
		]
	}
];

/** Invalid submissions (go to invalid_submissions table, minimal shape) */
const invalidMocks = [
	{
		uuid: 'mock-invalid-future-dob-2026-04-28',
		payload: {
			childFirstName: 'Future',
			childLastName: 'Child',
			childDob: '2099-01-01',
			screening: 'Yes'
		},
		errors: [{ path: ['childDob'], message: 'Date of birth cannot be in the future' }],
		createdAt: '2026-04-28T10:00:00Z'
	},
	{
		uuid: 'mock-invalid-missing-consent-2026-04-30',
		payload: {
			childFirstName: 'Missing',
			childLastName: 'Consent',
			childDob: '2015-03-10',
			screening: 'Yes',
			primaryCareAndControl: 0
		},
		errors: [{ path: ['primaryCareAndControl'], message: 'Must confirm primary care and control' }],
		createdAt: '2026-04-30T14:30:00Z'
	}
];

const userAgents = [
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4) Safari/17.4',
	'Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Mobile/15E148'
];
const ipPool = ['203.0.113.10', '198.51.100.42', '192.0.2.88', '203.0.113.55'];

const sqlite = new Database(dbUrl);
sqlite.pragma('foreign_keys = ON');

console.log(`seed-mock: targeting ${dbUrl} and ${attachmentsDir}`);

const tx = sqlite.transaction(() => {
	sqlite.exec(
		`DELETE FROM submission_attachments;
		 DELETE FROM submission_metadata;
		 DELETE FROM submissions;
		 DELETE FROM invalid_submissions;`
	);

	const insSubmission = sqlite.prepare(
		`INSERT INTO submissions
			(submission_uuid, status, submitter_surname,
			 child_youth_first_name, child_youth_middle_names, child_youth_last_name,
			 child_youth_dob, child_youth_gender,
			 signatory_first_name, signatory_last_name, signatory_dob, signatory_gender,
			 signatory_relationship, primary_phone, email,
			 screening, not_submitting_reasons, assessments,
			 primary_care_and_control, consent_collection, consent_disclosure,
			 confirm_not_submitting, signature, date_signed,
			 raw_payload, created_at, updated_at)
		 VALUES (
			@uuid, @status, @submitterSurname,
			@childFirstName, @childMiddleNames, @childLastName,
			@childDob, @childGender,
			@signatoryFirstName, @signatoryLastName, @signatoryDob, @signatoryGender,
			@signatoryRelationship, @primaryPhone, @email,
			@screening, @notSubmittingReasons, @assessments,
			@primaryCareAndControl, @consentCollection, @consentDisclosure,
			@confirmNotSubmitting, @signature, @dateSigned,
			@rawPayload, @createdAt, @createdAt)`
	);

	const insMetadata = sqlite.prepare(
		`INSERT INTO submission_metadata
			(submission_id, ip_address, user_agent, accept_language, referer,
			 request_method, tls_version, session_id, browser_fingerprint,
			 csrf_token_echo, submission_timestamp)
		 VALUES (?, ?, ?, ?, ?, 'POST', 'TLSv1.3', ?, ?, ?, ?)`
	);

	const insAttachment = sqlite.prepare(
		`INSERT INTO submission_attachments
			(submission_id, assessment_index, original_filename, stored_path, size_bytes, mime_type, sha256)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);

	const insOcrResult = sqlite.prepare(
		`INSERT INTO ocr_results
			(attachment_id, raw_text, pages, model_id, api_version, processed_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	const insInvalid = sqlite.prepare(
		`INSERT INTO invalid_submissions
			(submission_uuid, raw_payload, validation_errors, ip_address, user_agent, received_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	// Insert valid submissions
	for (const m of mocks) {
		const assessmentsJson = m.assessments ? JSON.stringify(m.assessments) : null;
		const notSubmittingReasonsJson = m.notSubmittingReasons
			? JSON.stringify(m.notSubmittingReasons)
			: null;

		const rawPayload = JSON.stringify({
			childFirstName: m.childFirstName,
			childMiddleNames: m.childMiddleNames ?? null,
			childLastName: m.childLastName,
			childDob: m.childDob,
			childGender: m.childGender,
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
		});

		const subRow = insSubmission.run({
			uuid: m.uuid,
			status: m.status,
			submitterSurname: m.signatoryLastName,
			childFirstName: m.childFirstName,
			childMiddleNames: m.childMiddleNames ?? null,
			childLastName: m.childLastName,
			childDob: m.childDob,
			childGender: m.childGender,
			signatoryFirstName: m.signatoryFirstName,
			signatoryLastName: m.signatoryLastName,
			signatoryDob: m.signatoryDob,
			signatoryGender: m.signatoryGender,
			signatoryRelationship: m.signatoryRelationship,
			primaryPhone: m.primaryPhone,
			email: m.email,
			screening: m.screening,
			notSubmittingReasons: notSubmittingReasonsJson,
			assessments: assessmentsJson,
			primaryCareAndControl: m.primaryCareAndControl,
			consentCollection: m.consentCollection ?? null,
			consentDisclosure: m.consentDisclosure ?? null,
			confirmNotSubmitting: m.confirmNotSubmitting ?? null,
			signature: m.signature,
			dateSigned: m.dateSigned,
			rawPayload,
			createdAt: m.createdAt
		});
		const submissionId = Number(subRow.lastInsertRowid);

		insMetadata.run(
			submissionId,
			ipPool[Math.floor(Math.random() * ipPool.length)],
			userAgents[Math.floor(Math.random() * userAgents.length)],
			'en-CA,en;q=0.9',
			'https://example.gov.bc.ca/',
			randomBytes(8).toString('hex'),
			randomBytes(16).toString('hex'),
			randomBytes(16).toString('hex'),
			m.createdAt
		);

		if (m.attachments?.length) {
			const dir = path.resolve(attachmentsDir, m.uuid);
			rmSync(dir, { recursive: true, force: true });
			mkdirSync(dir, { recursive: true });
			for (const a of m.attachments) {
				const stored = path.join(dir, a.name);
				writeFileSync(stored, a.bytes);
				const sha = createHash('sha256').update(a.bytes).digest('hex');
				const attRow = insAttachment.run(
					submissionId,
					a.assessmentIndex,
					a.name,
					stored,
					a.bytes.length,
					a.mime,
					sha
				);

				// Seed extracted OCR text so document-content search is testable.
				// Present only for attachments on OCR-completed submissions.
				const ocrText = OCR_TEXT[a.name];
				if (ocrText) {
					const pages = Math.max(1, Math.round(ocrText.length / 700));
					insOcrResult.run(
						Number(attRow.lastInsertRowid),
						ocrText,
						pages,
						OCR_MODEL_ID,
						OCR_API_VERSION,
						m.createdAt
					);
				}
			}
		}
	}

	// Insert invalid submissions
	for (const inv of invalidMocks) {
		insInvalid.run(
			inv.uuid,
			JSON.stringify(inv.payload),
			JSON.stringify(inv.errors),
			ipPool[Math.floor(Math.random() * ipPool.length)],
			userAgents[Math.floor(Math.random() * userAgents.length)],
			inv.createdAt
		);
	}
});

tx();
sqlite.close();

const counts = (() => {
	const db = new Database(dbUrl);
	const subs = /** @type {{ status: string, n: number }[]} */ (
		db
			.prepare(`SELECT status, count(*) as n FROM submissions GROUP BY status ORDER BY status`)
			.all()
	);
	const inv = /** @type {{ n: number }} */ (
		db.prepare(`SELECT count(*) as n FROM invalid_submissions`).get()
	);
	const att = /** @type {{ n: number }} */ (
		db.prepare(`SELECT count(*) as n FROM submission_attachments`).get()
	);
	const ocr = /** @type {{ n: number }} */ (
		db.prepare(`SELECT count(*) as n FROM ocr_results`).get()
	);
	db.close();
	return { subs, inv: inv.n, att: att.n, ocr: ocr.n };
})();

console.log('seed-mock: done.');
console.log(`  submissions by status:`);
for (const s of counts.subs) console.log(`    ${s.status.padEnd(20)} ${s.n}`);
console.log(`  invalid_submissions: ${counts.inv}`);
console.log(`  attachments:         ${counts.att}`);
console.log(`  ocr_results:         ${counts.ocr}`);
