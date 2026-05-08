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

/** @typedef {{
 *   uuid: string;
 *   surname: string | null;
 *   status: string;
 *   createdAt: string;
 *   payload: Record<string, unknown>;
 *   attachments?: Array<{ name: string; mime: string; bytes: Buffer }>;
 * }} Mock
 */

/** @type {Mock[]} */
const mocks = [
	{
		uuid: 'mock-adams-2026-04-02',
		surname: 'Adams',
		status: 'submitted',
		createdAt: '2026-04-02T09:14:22Z',
		payload: childPayload({
			dob: '2017-03-11',
			lang: 'English',
			devConcerns: true,
			ageFirst: '1-2',
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['BCAAN', 'Vineland 3'],
			impact: ['2', '2', '1', '1'],
			conds: ['ADHD'],
			services: ['SLP', 'School'],
			hours: 6
		}),
		attachments: [{ name: 'assessment-report.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-brown-2026-04-04',
		surname: 'Brown',
		status: 'OCR queued',
		createdAt: '2026-04-04T15:02:08Z',
		payload: childPayload({
			dob: '2018-06-23',
			lang: 'French',
			devConcerns: true,
			ageFirst: '<1',
			diagnosis: false,
			diagStatus: 'Under Assessment',
			tools: ['Unknown'],
			impact: ['3', '2', '2', '3'],
			conds: ['ID', 'ADHD'],
			services: ['Behaviour', 'SLP'],
			hours: 12
		}),
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
		payload: childPayload({
			dob: '2016-11-04',
			lang: 'English',
			devConcerns: false,
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['BCAAN'],
			impact: ['1', '0', '1', '0'],
			conds: ['None'],
			services: ['School'],
			hours: 2
		}),
		attachments: [{ name: 'bcaan-report.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-davis-2026-04-10',
		surname: 'Davis',
		status: 'OCR Error',
		createdAt: '2026-04-10T08:21:00Z',
		payload: childPayload({
			dob: '2019-01-30',
			lang: 'English',
			devConcerns: true,
			ageFirst: '2-3',
			diagnosis: true,
			diagStatus: 'Provisional',
			tools: ['Vineland', 'IEP'],
			impact: ['2', '2', '2', '2'],
			conds: ['Anxiety', 'Speech'],
			services: ['SLP', 'OT'],
			hours: 8
		}),
		attachments: [{ name: 'corrupted-scan.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-edwards-2026-04-12',
		surname: 'Edwards',
		status: 'ready for review',
		createdAt: '2026-04-12T13:47:15Z',
		payload: childPayload({
			dob: '2017-09-19',
			lang: 'Other',
			devConcerns: true,
			ageFirst: '>3',
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['BCAAN', 'IEP'],
			impact: ['3', '3', '2', '2'],
			conds: ['ID', 'Seizures'],
			services: ['Behaviour', 'OT', 'School'],
			hours: 15
		})
	},
	{
		uuid: 'mock-foster-2026-04-14',
		surname: 'Foster',
		status: 'ready for clinician',
		createdAt: '2026-04-14T16:55:33Z',
		payload: childPayload({
			dob: '2018-04-08',
			lang: 'English',
			devConcerns: true,
			ageFirst: '1-2',
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['BCAAN', 'Vineland 3', 'IEP'],
			impact: ['2', '3', '2', '3'],
			conds: ['ADHD', 'Anxiety'],
			services: ['Behaviour', 'SLP'],
			hours: 10
		}),
		attachments: [{ name: 'clinician-summary.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	},
	{
		uuid: 'mock-gomez-2026-04-16',
		surname: 'Gomez',
		status: 'reviewed',
		createdAt: '2026-04-16T10:08:41Z',
		payload: childPayload({
			dob: '2016-07-22',
			lang: 'English',
			devConcerns: false,
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['Vineland 3'],
			impact: ['1', '1', '1', '0'],
			conds: ['None'],
			services: ['None'],
			hours: 0
		})
	},
	{
		uuid: 'mock-harrison-2026-04-18',
		surname: 'Harrison',
		status: 'submitted',
		createdAt: '2026-04-18T07:12:05Z',
		payload: childPayload({
			dob: '2020-02-14',
			lang: 'French',
			devConcerns: true,
			ageFirst: '<1',
			diagnosis: false,
			diagStatus: 'None',
			tools: ['Unknown'],
			impact: ['1', '2', '0', '1'],
			conds: ['Speech'],
			services: ['SLP'],
			hours: 4
		})
	},
	{
		uuid: 'mock-iyer-2026-04-20',
		surname: 'Iyer',
		status: 'submitted',
		createdAt: '2026-04-20T14:33:12Z',
		payload: childPayload({
			dob: '2017-12-01',
			lang: 'Other',
			devConcerns: true,
			ageFirst: '2-3',
			diagnosis: true,
			diagStatus: 'Provisional',
			tools: ['Non BCAAN'],
			impact: ['2', '1', '2', '2'],
			conds: ['ADHD'],
			services: ['School', 'OT'],
			hours: 7
		}),
		attachments: [
			{ name: 'pediatrician-letter.pdf', mime: 'application/pdf', bytes: TINY_PDF },
			{ name: 'iep-summary.pdf', mime: 'application/pdf', bytes: TINY_PDF }
		]
	},
	{
		uuid: 'mock-johnson-2026-04-22',
		surname: 'Johnson',
		status: 'invalid',
		createdAt: '2026-04-22T09:48:00Z',
		payload: childPayload({
			dob: '2018-08-30',
			lang: 'English',
			devConcerns: true,
			ageFirst: '1-2',
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['BCAAN'],
			impact: ['1', '1', '1', '1'],
			conds: ['None'],
			services: ['School'],
			hours: 3
		})
	},
	{
		uuid: 'mock-kumar-2026-04-24',
		surname: 'Kumar',
		status: 'invalid',
		createdAt: '2026-04-24T18:25:30Z',
		payload: childPayload({
			dob: '2099-01-01', // future DOB — would have failed Zod, kept here as historical record
			lang: 'English',
			devConcerns: false,
			diagnosis: false,
			diagStatus: 'None',
			tools: [],
			impact: ['0', '0', '0', '0'],
			conds: ['None'],
			services: ['None'],
			hours: 0
		})
	},
	{
		uuid: 'mock-liu-2026-04-26',
		surname: 'Liu',
		status: 'submitted',
		createdAt: '2026-04-26T12:00:00Z',
		payload: childPayload({
			dob: '2019-05-17',
			lang: 'English',
			devConcerns: true,
			ageFirst: '<1',
			diagnosis: true,
			diagStatus: 'Confirmed',
			tools: ['BCAAN', 'Vineland 3'],
			impact: ['3', '2', '3', '2'],
			conds: ['ID', 'ADHD', 'Anxiety'],
			services: ['Behaviour', 'SLP', 'OT', 'School'],
			hours: 18
		}),
		attachments: [{ name: 'multidisciplinary-report.pdf', mime: 'application/pdf', bytes: TINY_PDF }]
	}
];

/**
 * @param {{
 *   dob: string; lang: string;
 *   devConcerns: boolean; ageFirst?: string;
 *   diagnosis: boolean; diagStatus: string; tools: string[];
 *   impact: [string, string, string, string];
 *   conds: string[]; services: string[]; hours: number;
 * }} args
 */
function childPayload(args) {
	return {
		dateOfBirth: args.dob,
		primaryLanguage: args.lang,
		developmentalConcerns: args.devConcerns,
		ageOfFirstConcern: args.devConcerns ? args.ageFirst ?? null : null,
		hasFormalDiagnosis: args.diagnosis,
		diagnosticStatus: args.diagStatus,
		assessmentTools: args.tools,
		communication: args.impact[0],
		socialInteraction: args.impact[1],
		dailyLivingSkills: args.impact[2],
		behaviouralConcerns: args.impact[3],
		conditions: args.conds,
		services: args.services,
		weeklyHours: args.hours
	};
}

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
			 dateOfBirth, primaryLanguage,
			 developmentalConcerns, ageOfFirstConcern,
			 hasFormalDiagnosis, diagnosticStatus, assessmentTools,
			 communication, socialInteraction, dailyLivingSkills, behaviouralConcerns,
			 conditions, services, weeklyHours,
			 informationAccurate, dataSharingConsent, raw_payload,
			 created_at, updated_at)
		 VALUES (@uuid, @status, @surname,
			@dateOfBirth, @primaryLanguage,
			@developmentalConcerns, @ageOfFirstConcern,
			@hasFormalDiagnosis, @diagnosticStatus, @assessmentTools,
			@communication, @socialInteraction, @dailyLivingSkills, @behaviouralConcerns,
			@conditions, @services, @weeklyHours,
			1, 1, @rawPayload,
			@createdAt, @createdAt)`
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
			(submission_id, original_filename, stored_path, size_bytes, mime_type, sha256, uploaded_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);

	const insInvalid = sqlite.prepare(
		`INSERT INTO invalid_submissions
			(submission_uuid, raw_payload, validation_errors, ip_address, user_agent, received_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	for (const m of mocks) {
		if (m.status === 'invalid') {
			insInvalid.run(
				m.uuid,
				JSON.stringify(m.payload),
				JSON.stringify([
					{ path: ['dateOfBirth'], message: m.uuid.includes('kumar') ? 'Date of birth cannot be in the future' : 'Mocked validation failure' }
				]),
				ipPool[Math.floor(Math.random() * ipPool.length)],
				userAgents[Math.floor(Math.random() * userAgents.length)],
				m.createdAt
			);
			continue;
		}

		const subRow = insSubmission.run({
			uuid: m.uuid,
			status: m.status,
			surname: m.surname,
			dateOfBirth: m.payload.dateOfBirth,
			primaryLanguage: m.payload.primaryLanguage,
			developmentalConcerns: m.payload.developmentalConcerns ? 1 : 0,
			ageOfFirstConcern: m.payload.ageOfFirstConcern ?? null,
			hasFormalDiagnosis: m.payload.hasFormalDiagnosis ? 1 : 0,
			diagnosticStatus: m.payload.diagnosticStatus,
			assessmentTools: JSON.stringify(m.payload.assessmentTools ?? []),
			communication: m.payload.communication,
			socialInteraction: m.payload.socialInteraction,
			dailyLivingSkills: m.payload.dailyLivingSkills,
			behaviouralConcerns: m.payload.behaviouralConcerns,
			conditions: JSON.stringify(m.payload.conditions ?? []),
			services: JSON.stringify(m.payload.services ?? []),
			weeklyHours: m.payload.weeklyHours,
			rawPayload: JSON.stringify({ ...m.payload, surname: m.surname }),
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
				insAttachment.run(
					submissionId,
					a.name,
					stored,
					a.bytes.length,
					a.mime,
					sha,
					m.createdAt
				);
			}
		}
	}
});

tx();
sqlite.close();

const counts = (() => {
	const db = new Database(dbUrl);
	const subs = /** @type {{ status: string, n: number }[]} */ (
		db.prepare(`SELECT status, count(*) as n FROM submissions GROUP BY status ORDER BY status`).all()
	);
	const inv = /** @type {{ n: number }} */ (
		db.prepare(`SELECT count(*) as n FROM invalid_submissions`).get()
	);
	const att = /** @type {{ n: number }} */ (
		db.prepare(`SELECT count(*) as n FROM submission_attachments`).get()
	);
	db.close();
	return { subs, inv: inv.n, att: att.n };
})();

console.log('seed-mock: done.');
console.log(`  submissions by status:`);
for (const s of counts.subs) console.log(`    ${s.status.padEnd(20)} ${s.n}`);
console.log(`  invalid_submissions: ${counts.inv}`);
console.log(`  attachments:         ${counts.att}`);
