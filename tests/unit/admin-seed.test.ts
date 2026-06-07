import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { seedMockSubmissions, clearAllSubmissions } from '$lib/server/admin-seed';

let tmpDir: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(os.tmpdir(), 'cydb-admin-seed-'));
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, {
		migrationsFolder: path.resolve(__dirname, '../../src/lib/server/db/migrations')
	});
});

afterEach(() => {
	sqlite.close();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe('seedMockSubmissions', () => {
	it('inserts 10 valid submissions, 2 invalid, 9 attachments, and 2 OCR results', async () => {
		const result = await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		expect(result.submissions).toBe(10);
		expect(result.invalid).toBe(2);
		expect(result.attachments).toBe(9);
		expect(result.ocrResults).toBe(2);

		const subRow = sqlite.prepare(`SELECT count(*) as n FROM submissions`).get() as { n: number };
		expect(subRow.n).toBe(10);
		const invRow = sqlite.prepare(`SELECT count(*) as n FROM invalid_submissions`).get() as {
			n: number;
		};
		expect(invRow.n).toBe(2);
		const attRow = sqlite.prepare(`SELECT count(*) as n FROM submission_attachments`).get() as {
			n: number;
		};
		expect(attRow.n).toBe(9);
		const ocrRow = sqlite.prepare(`SELECT count(*) as n FROM ocr_results`).get() as { n: number };
		expect(ocrRow.n).toBe(2);
		// OCR text is searchable document content (the search index reads ocr_results.raw_text).
		const ados = sqlite
			.prepare(`SELECT count(*) as n FROM ocr_results WHERE raw_text LIKE '%ADOS-2%'`)
			.get() as { n: number };
		expect(ados.n).toBe(1);
	});

	it('writes attachment files to disk under <attachmentsDir>/<uuid>/', async () => {
		await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		const dirs = readdirSync(tmpDir);
		expect(dirs.length).toBeGreaterThan(0);
		// The seed inserts at least one attachment for some submissions; the dir should have a file inside
		const firstDir = path.join(tmpDir, dirs[0]);
		expect(readdirSync(firstDir).length).toBeGreaterThan(0);
	});

	it('is idempotent: re-running wipes and re-seeds with the same row counts', async () => {
		await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		const result = await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		expect(result.submissions).toBe(10);
		expect(result.invalid).toBe(2);
		const subRow = sqlite.prepare(`SELECT count(*) as n FROM submissions`).get() as { n: number };
		expect(subRow.n).toBe(10);
	});
});

describe('clearAllSubmissions', () => {
	it('deletes all rows from the four submission tables', async () => {
		await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		const result = await clearAllSubmissions({ db: db as never, attachmentsDir: tmpDir });
		expect(result.cleared).toBe(true);

		for (const t of [
			'submissions',
			'submission_metadata',
			'submission_attachments',
			'ocr_results',
			'invalid_submissions'
		]) {
			const row = sqlite.prepare(`SELECT count(*) as n FROM ${t}`).get() as { n: number };
			expect(row.n).toBe(0);
		}
	});

	it('removes the per-submission attachment directories from disk', async () => {
		await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		expect(readdirSync(tmpDir).length).toBeGreaterThan(0);
		await clearAllSubmissions({ db: db as never, attachmentsDir: tmpDir });
		expect(readdirSync(tmpDir).length).toBe(0);
	});

	it('does not touch user, session, account, or user_roles tables', async () => {
		sqlite
			.prepare(`INSERT INTO user (id, name, email, email_verified) VALUES ('u1','a','a@x.test',0)`)
			.run();
		sqlite.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('u1','admin')`).run();
		await seedMockSubmissions({ db: db as never, attachmentsDir: tmpDir });
		await clearAllSubmissions({ db: db as never, attachmentsDir: tmpDir });
		const userRow = sqlite.prepare(`SELECT count(*) as n FROM user`).get() as { n: number };
		const roleRow = sqlite.prepare(`SELECT count(*) as n FROM user_roles`).get() as { n: number };
		expect(userRow.n).toBe(1);
		expect(roleRow.n).toBe(1);
	});

	it('is safe to call against an already-empty database', async () => {
		const result = await clearAllSubmissions({ db: db as never, attachmentsDir: tmpDir });
		expect(result.cleared).toBe(true);
	});
});
