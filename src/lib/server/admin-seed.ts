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
}

interface MockSubmission {
	uuid: string;
	surname: string | null;
	status: string;
	createdAt: string;
	dateOfBirth: string;
	primaryLanguage: string;
	developmentalConcerns: boolean;
	ageOfFirstConcern: string | null;
	hasFormalDiagnosis: boolean;
	diagnosticStatus: string;
	assessmentTools: string[];
	communication: string;
	socialInteraction: string;
	dailyLivingSkills: string;
	behaviouralConcerns: string;
	conditions: string[];
	services: string[];
	weeklyHours: number;
	attachments?: MockAttachment[];
	invalid?: boolean;
	invalidReason?: string;
}

const MOCKS: MockSubmission[] = [
	{
		uuid: 'mock-adams-2026-04-02',
		surname: 'Adams',
		status: 'submitted',
		createdAt: '2026-04-02T09:14:22Z',
		dateOfBirth: '2017-03-11',
		primaryLanguage: 'English',
		developmentalConcerns: true,
		ageOfFirstConcern: '1-2',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['BCAAN', 'Vineland 3'],
		communication: '2',
		socialInteraction: '2',
		dailyLivingSkills: '1',
		behaviouralConcerns: '1',
		conditions: ['ADHD'],
		services: ['SLP', 'School'],
		weeklyHours: 6,
		attachments: [{ name: 'assessment-report.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-brown-2026-04-04',
		surname: 'Brown',
		status: 'OCR queued',
		createdAt: '2026-04-04T15:02:08Z',
		dateOfBirth: '2018-06-23',
		primaryLanguage: 'French',
		developmentalConcerns: true,
		ageOfFirstConcern: '<1',
		hasFormalDiagnosis: false,
		diagnosticStatus: 'Under Assessment',
		assessmentTools: ['Unknown'],
		communication: '3',
		socialInteraction: '2',
		dailyLivingSkills: '2',
		behaviouralConcerns: '3',
		conditions: ['ID', 'ADHD'],
		services: ['Behaviour', 'SLP'],
		weeklyHours: 12,
		attachments: [
			{ name: 'iep-2025.pdf', mime: 'application/pdf', bytes: TINY_PDF },
			{ name: 'photo.png', mime: 'image/png', bytes: TINY_PNG }
		]
	},
	{
		uuid: 'mock-chen-2026-04-07',
		surname: 'Chen',
		status: 'OCR processed',
		createdAt: '2026-04-07T11:38:50Z',
		dateOfBirth: '2016-11-04',
		primaryLanguage: 'English',
		developmentalConcerns: false,
		ageOfFirstConcern: null,
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['BCAAN'],
		communication: '1',
		socialInteraction: '0',
		dailyLivingSkills: '1',
		behaviouralConcerns: '0',
		conditions: ['None'],
		services: ['School'],
		weeklyHours: 2,
		attachments: [{ name: 'bcaan-report.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-davis-2026-04-10',
		surname: 'Davis',
		status: 'OCR Error',
		createdAt: '2026-04-10T08:21:00Z',
		dateOfBirth: '2019-01-30',
		primaryLanguage: 'English',
		developmentalConcerns: true,
		ageOfFirstConcern: '2-3',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Provisional',
		assessmentTools: ['Vineland', 'IEP'],
		communication: '2',
		socialInteraction: '2',
		dailyLivingSkills: '2',
		behaviouralConcerns: '2',
		conditions: ['Anxiety', 'Speech'],
		services: ['SLP', 'OT'],
		weeklyHours: 8,
		attachments: [{ name: 'corrupted-scan.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-edwards-2026-04-12',
		surname: 'Edwards',
		status: 'ready for review',
		createdAt: '2026-04-12T13:47:15Z',
		dateOfBirth: '2017-09-19',
		primaryLanguage: 'Other',
		developmentalConcerns: true,
		ageOfFirstConcern: '>3',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['BCAAN', 'IEP'],
		communication: '3',
		socialInteraction: '3',
		dailyLivingSkills: '2',
		behaviouralConcerns: '2',
		conditions: ['ID', 'Seizures'],
		services: ['Behaviour', 'OT', 'School'],
		weeklyHours: 15
	},
	{
		uuid: 'mock-foster-2026-04-14',
		surname: 'Foster',
		status: 'ready for clinician',
		createdAt: '2026-04-14T16:55:33Z',
		dateOfBirth: '2018-04-08',
		primaryLanguage: 'English',
		developmentalConcerns: true,
		ageOfFirstConcern: '1-2',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['BCAAN', 'Vineland 3', 'IEP'],
		communication: '2',
		socialInteraction: '3',
		dailyLivingSkills: '2',
		behaviouralConcerns: '3',
		conditions: ['ADHD', 'Anxiety'],
		services: ['Behaviour', 'SLP'],
		weeklyHours: 10,
		attachments: [{ name: 'clinician-summary.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-gomez-2026-04-16',
		surname: 'Gomez',
		status: 'reviewed',
		createdAt: '2026-04-16T10:08:41Z',
		dateOfBirth: '2016-07-22',
		primaryLanguage: 'English',
		developmentalConcerns: false,
		ageOfFirstConcern: null,
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['Vineland 3'],
		communication: '1',
		socialInteraction: '1',
		dailyLivingSkills: '1',
		behaviouralConcerns: '0',
		conditions: ['None'],
		services: ['None'],
		weeklyHours: 0
	},
	{
		uuid: 'mock-harrison-2026-04-18',
		surname: 'Harrison',
		status: 'submitted',
		createdAt: '2026-04-18T07:12:05Z',
		dateOfBirth: '2020-02-14',
		primaryLanguage: 'French',
		developmentalConcerns: true,
		ageOfFirstConcern: '<1',
		hasFormalDiagnosis: false,
		diagnosticStatus: 'None',
		assessmentTools: ['Unknown'],
		communication: '1',
		socialInteraction: '2',
		dailyLivingSkills: '0',
		behaviouralConcerns: '1',
		conditions: ['Speech'],
		services: ['SLP'],
		weeklyHours: 4
	},
	{
		uuid: 'mock-iyer-2026-04-20',
		surname: 'Iyer',
		status: 'submitted',
		createdAt: '2026-04-20T14:33:12Z',
		dateOfBirth: '2017-12-01',
		primaryLanguage: 'Other',
		developmentalConcerns: true,
		ageOfFirstConcern: '2-3',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Provisional',
		assessmentTools: ['Non BCAAN'],
		communication: '2',
		socialInteraction: '1',
		dailyLivingSkills: '2',
		behaviouralConcerns: '2',
		conditions: ['ADHD'],
		services: ['School', 'OT'],
		weeklyHours: 7,
		attachments: [
			{ name: 'pediatrician-letter.pdf', mime: 'application/pdf', bytes: TINY_PDF },
			{ name: 'iep-summary.pdf', mime: 'application/pdf', bytes: TINY_PDF }
		]
	},
	{
		uuid: 'mock-liu-2026-04-26',
		surname: 'Liu',
		status: 'submitted',
		createdAt: '2026-04-26T12:00:00Z',
		dateOfBirth: '2019-05-17',
		primaryLanguage: 'English',
		developmentalConcerns: true,
		ageOfFirstConcern: '<1',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['BCAAN', 'Vineland 3'],
		communication: '3',
		socialInteraction: '2',
		dailyLivingSkills: '3',
		behaviouralConcerns: '2',
		conditions: ['ID', 'ADHD', 'Anxiety'],
		services: ['Behaviour', 'SLP', 'OT', 'School'],
		weeklyHours: 18,
		attachments: [
			{ name: 'multidisciplinary-report.pdf', mime: 'application/pdf', bytes: TINY_PDF }
		]
	},
	{
		uuid: 'mock-johnson-2026-04-22',
		surname: 'Johnson',
		status: 'invalid',
		createdAt: '2026-04-22T09:48:00Z',
		dateOfBirth: '2018-08-30',
		primaryLanguage: 'English',
		developmentalConcerns: true,
		ageOfFirstConcern: '1-2',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['BCAAN'],
		communication: '1',
		socialInteraction: '1',
		dailyLivingSkills: '1',
		behaviouralConcerns: '1',
		conditions: ['None'],
		services: ['School'],
		weeklyHours: 3,
		invalid: true,
		invalidReason: 'Mocked validation failure'
	},
	{
		uuid: 'mock-kumar-2026-04-24',
		surname: 'Kumar',
		status: 'invalid',
		createdAt: '2026-04-24T18:25:30Z',
		dateOfBirth: '2099-01-01',
		primaryLanguage: 'English',
		developmentalConcerns: false,
		ageOfFirstConcern: null,
		hasFormalDiagnosis: false,
		diagnosticStatus: 'None',
		assessmentTools: [],
		communication: '0',
		socialInteraction: '0',
		dailyLivingSkills: '0',
		behaviouralConcerns: '0',
		conditions: ['None'],
		services: ['None'],
		weeklyHours: 0,
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
					dateOfBirth: m.dateOfBirth,
					primaryLanguage: m.primaryLanguage
				}),
				validationErrors: [
					{ path: ['dateOfBirth'], message: m.invalidReason ?? 'Mocked failure' }
				],
				ipAddress: pick(IPS),
				userAgent: pick(USER_AGENTS),
				receivedAt: m.createdAt
			});
			invalidCount += 1;
			continue;
		}

		const inserted = await opts.db
			.insert(submissions)
			.values({
				submissionUuid: m.uuid,
				status: m.status,
				submitterSurname: m.surname,
				dateOfBirth: m.dateOfBirth,
				primaryLanguage: m.primaryLanguage,
				developmentalConcerns: m.developmentalConcerns,
				ageOfFirstConcern: m.ageOfFirstConcern,
				hasFormalDiagnosis: m.hasFormalDiagnosis,
				diagnosticStatus: m.diagnosticStatus,
				assessmentTools: m.assessmentTools,
				communication: m.communication,
				socialInteraction: m.socialInteraction,
				dailyLivingSkills: m.dailyLivingSkills,
				behaviouralConcerns: m.behaviouralConcerns,
				conditions: m.conditions,
				services: m.services,
				weeklyHours: m.weeklyHours,
				informationAccurate: true,
				dataSharingConsent: true,
				rawPayload: { ...m, attachments: undefined },
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
