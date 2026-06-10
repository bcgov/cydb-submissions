import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/lib/server/db/schema';

function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });
	return { db, sqlite };
}

function cols(sqlite: Database.Database, table: string): string[] {
	return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
		(r) => r.name
	);
}

// Insert a row that satisfies every NOT NULL column on the new submissions table.
function insertSub(sqlite: Database.Database, uuid: string, status = 'submitted') {
	sqlite
		.prepare(
			`INSERT INTO submissions
        (submission_uuid, status, submitter_surname,
         child_youth_first_name, child_youth_last_name, child_youth_dob, child_youth_gender,
         signatory_first_name, signatory_last_name, signatory_dob, signatory_gender, signatory_relationship,
         primary_phone, email, screening, primary_care_and_control, signature, date_signed, raw_payload)
       VALUES (?, ?, 'Smith',
         'Jordan', 'Smith', '2015-06-01', 'nonBinaryPerson',
         'Alex', 'Smith', '1985-02-20', 'womanGirl', 'Parent',
         '250-555-0100', 'a@x', 'Yes', 1, 'data:image/png;base64,AAAA', '2026-06-01', '{}')`
		)
		.run(uuid, status);
}

describe('database schema', () => {
	it('creates the core tables', () => {
		const { sqlite } = freshDb();
		const tables = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all()
			.map((r: any) => r.name);
		expect(tables).toEqual(
			expect.arrayContaining([
				'submissions',
				'submission_metadata',
				'submission_attachments',
				'invalid_submissions'
			])
		);
	});

	it('has the new identity, screening, assessments, consent, and signature columns', () => {
		const { sqlite } = freshDb();
		const c = cols(sqlite, 'submissions');
		for (const expected of [
			'child_youth_first_name',
			'child_youth_last_name',
			'child_youth_dob',
			'child_youth_gender',
			'signatory_first_name',
			'signatory_last_name',
			'signatory_dob',
			'signatory_gender',
			'signatory_relationship',
			'primary_phone',
			'email',
			'screening',
			'not_submitting_reasons',
			'assessments',
			'primary_care_and_control',
			'consent_collection',
			'consent_disclosure',
			'confirm_not_submitting',
			'signature',
			'date_signed',
			'submitter_surname',
			'raw_payload',
			'status'
		])
			expect(c, expected).toContain(expected);
	});

	it('no longer has the old clinical columns', () => {
		const { sqlite } = freshDb();
		const c = cols(sqlite, 'submissions');
		for (const gone of [
			'hasFormalDiagnosis',
			'developmentalConcerns',
			'weeklyHours',
			'dateOfBirth',
			'informationAccurate'
		]) {
			expect(c).not.toContain(gone);
		}
	});

	it('submission_attachments has assessment_index', () => {
		const { sqlite } = freshDb();
		expect(cols(sqlite, 'submission_attachments')).toContain('assessment_index');
	});

	it('enforces unique submission_uuid', () => {
		const { sqlite } = freshDb();
		insertSub(sqlite, 'u1');
		expect(() => insertSub(sqlite, 'u1')).toThrow(/UNIQUE/);
	});

	it('cascades attachments delete when submission removed', () => {
		const { sqlite } = freshDb();
		insertSub(sqlite, 'u2');
		const subId = sqlite.prepare(`SELECT id FROM submissions WHERE submission_uuid='u2'`).get() as {
			id: number;
		};
		sqlite
			.prepare(
				`INSERT INTO submission_attachments (submission_id, assessment_index, original_filename, stored_path, size_bytes, mime_type, sha256)
       VALUES (?, 0, 'a.pdf', '/x', 10, 'application/pdf', 'abc')`
			)
			.run(subId.id);
		sqlite.prepare(`DELETE FROM submissions WHERE id = ?`).run(subId.id);
		const remaining = sqlite.prepare(`SELECT count(*) AS c FROM submission_attachments`).get() as {
			c: number;
		};
		expect(remaining.c).toBe(0);
	});
});

describe('status enum + roles', () => {
	it('rejects an invalid status enum value', () => {
		const { sqlite } = freshDb();
		expect(() => insertSub(sqlite, 'u-bogus', 'bogus')).toThrow(/CHECK constraint/i);
	});

	it('accepts every documented status value', () => {
		const { sqlite } = freshDb();
		const statuses = [
			'submitted',
			'OCR queued',
			'OCR Error',
			'OCR processed',
			'ready for review',
			'ready for clinician',
			'reviewed',
			'invalid'
		];
		for (const status of statuses) insertSub(sqlite, `u-${status}`, status);
		const count = sqlite.prepare('SELECT count(*) as n FROM submissions').get() as { n: number };
		expect(count.n).toBe(statuses.length);
	});

	it('user_roles unique-constrains (user_id, role)', () => {
		const { sqlite } = freshDb();
		sqlite
			.prepare(`INSERT INTO user (id, name, email, email_verified) VALUES ('u1', 'a', 'a@x', 0)`)
			.run();
		sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1', 'admin')`).run();
		expect(() =>
			sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1', 'admin')`).run()
		).toThrow(/UNIQUE/i);
	});

	it('user_roles rejects unknown role values', () => {
		const { sqlite } = freshDb();
		sqlite
			.prepare(`INSERT INTO user (id, name, email, email_verified) VALUES ('u2', 'b', 'b@x', 0)`)
			.run();
		expect(() =>
			sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u2', 'wizard')`).run()
		).toThrow(/CHECK/i);
	});
});

describe('revoked_user_roles schema', () => {
	it('has the overlay table with role CHECK + unique (user_id, role)', () => {
		const { sqlite } = freshDb();
		const c = cols(sqlite, 'revoked_user_roles');
		for (const col of ['id', 'user_id', 'role', 'reason', 'revoked_by', 'revoked_at']) {
			expect(c, col).toContain(col);
		}
		// unknown role rejected by CHECK
		sqlite.exec(`INSERT INTO user (id, name, email, email_verified) VALUES ('ru1','R','r@x',0)`);
		expect(() =>
			sqlite
				.prepare(
					`INSERT INTO revoked_user_roles (user_id, role, revoked_by) VALUES ('ru1','wizard','ru1')`
				)
				.run()
		).toThrow(/CHECK/i);
		// duplicate (user_id, role) rejected by unique
		sqlite
			.prepare(
				`INSERT INTO revoked_user_roles (user_id, role, revoked_by) VALUES ('ru1','admin','ru1')`
			)
			.run();
		expect(() =>
			sqlite
				.prepare(
					`INSERT INTO revoked_user_roles (user_id, role, revoked_by) VALUES ('ru1','admin','ru1')`
				)
				.run()
		).toThrow(/UNIQUE/i);
	});
});
