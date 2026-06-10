import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export function dbPath(): string {
	return path.join(repoRoot, 'local.db');
}

export function resetSubmissions() {
	const db = new Database(dbPath());
	db.pragma('foreign_keys = ON');
	db.exec(
		'DELETE FROM submission_attachments; DELETE FROM submission_metadata; DELETE FROM submissions; DELETE FROM invalid_submissions;'
	);
	db.close();
}

export function resetUsers() {
	const db = new Database(dbPath());
	db.pragma('foreign_keys = ON');
	db.exec('DELETE FROM session; DELETE FROM account; DELETE FROM user_roles; DELETE FROM "user";');
	db.close();
}

export interface SeededSubmission {
	uuid: string;
	surname?: string | null;
	status?: string;
	createdAt?: string;
	screening?: string;
	childFirstName?: string;
}

export function seedSubmissions(items: SeededSubmission[]) {
	const db = new Database(dbPath());
	db.pragma('foreign_keys = ON');
	const stmt = db.prepare(
		`INSERT INTO submissions (
			submission_uuid, status, submitter_surname,
			child_youth_first_name, child_youth_middle_names, child_youth_last_name,
			child_youth_dob, child_youth_gender,
			signatory_first_name, signatory_last_name, signatory_dob, signatory_gender,
			signatory_relationship, primary_phone, email,
			screening, primary_care_and_control, signature, date_signed,
			raw_payload, created_at, updated_at
		) VALUES (
			?, ?, ?,
			?, NULL, ?,
			'2015-06-01', 'nonBinaryPerson',
			'Pat', ?, '1985-02-20', 'womanGirl',
			'Parent', '250-555-0100', 'seed@example.com',
			?, 1, 'data:image/png;base64,AAAA', '2026-06-01',
			'{}', ?, ?
		)`
	);
	for (const it of items) {
		const ts = it.createdAt ?? new Date().toISOString();
		const lastName = it.surname ?? 'Test';
		const firstName = it.childFirstName ?? 'Test';
		const screening = it.screening ?? 'Yes';
		stmt.run(
			it.uuid,
			it.status ?? 'submitted',
			it.surname ?? null,
			firstName,
			lastName,
			lastName,
			screening,
			ts,
			ts
		);
	}
	db.close();
}

export interface SeededAttachment {
	submissionUuid: string;
	storedPath: string;
	originalFilename: string;
	mimeType: string;
	sizeBytes: number;
	sha256?: string;
}

export function seedAttachments(atts: SeededAttachment[]) {
	const db = new Database(dbPath());
	db.pragma('foreign_keys = ON');
	for (const a of atts) {
		const sub = db
			.prepare(`SELECT id FROM submissions WHERE submission_uuid = ?`)
			.get(a.submissionUuid) as { id: number } | undefined;
		if (!sub) throw new Error(`submission ${a.submissionUuid} not seeded`);
		db.prepare(
			`INSERT INTO submission_attachments (submission_id, original_filename, stored_path, size_bytes, mime_type, sha256)
			 VALUES (?, ?, ?, ?, ?, ?)`
		).run(sub.id, a.originalFilename, a.storedPath, a.sizeBytes, a.mimeType, a.sha256 ?? 'na');
	}
	db.close();
}

export function seedUserWithRole(id: string, email: string, role: string) {
	const db = new Database(dbPath());
	db.pragma('foreign_keys = ON');
	db.prepare(
		`INSERT OR IGNORE INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, 0)`
	).run(id, email.split('@')[0], email);
	db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)`).run(id, role);
	db.close();
}

export function deleteUser(id: string) {
	const db = new Database(dbPath());
	db.pragma('foreign_keys = ON');
	// CASCADE deletes user_roles and revoked_user_roles for this user.
	db.prepare(`DELETE FROM "user" WHERE id = ?`).run(id);
	db.close();
}
