import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { recordDecision, resetDecision } from '$lib/server/decision-store';

const SUB = `INSERT INTO submissions
 (submission_uuid, status, child_youth_first_name, child_youth_last_name, child_youth_dob, child_youth_gender,
  signatory_first_name, signatory_last_name, signatory_dob, signatory_gender, signatory_relationship,
  primary_phone, email, screening, primary_care_and_control, signature, date_signed, raw_payload)
 VALUES ('s1','ready for review','J','S','2015-01-01','nonBinaryPerson','A','S','1980-01-01','womanGirl','Parent',
  '250','a@x','Yes',1,'sig','2026-01-01','{}')`;

describe('decision-store', () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	let subId: number;
	beforeEach(() => {
		sqlite = new Database(':memory:');
		db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });
		sqlite.exec(SUB);
		subId = (
			sqlite.prepare(`SELECT id FROM submissions WHERE submission_uuid='s1'`).get() as {
				id: number;
			}
		).id;
	});
	afterEach(() => sqlite.close());

	it('records a rejection: status + reasons snapshot + who/when', async () => {
		const res = await recordDecision(db as never, {
			submissionId: subId,
			decision: 'rejected',
			reasons: ['Incomplete information'],
			decidedBy: 'admin-1'
		});
		expect(res).toBe('ok');
		const row = sqlite
			.prepare(
				`SELECT status, decision, decision_reasons, decided_by, decided_at FROM submissions WHERE id=?`
			)
			.get(subId) as any;
		expect(row.status).toBe('rejected');
		expect(row.decision).toBe('rejected');
		expect(JSON.parse(row.decision_reasons)).toEqual(['Incomplete information']);
		expect(row.decided_by).toBe('admin-1');
		expect(row.decided_at).toBeTruthy();
	});

	it('is write-once: a second decision returns already_decided and does not overwrite', async () => {
		await recordDecision(db as never, {
			submissionId: subId,
			decision: 'accepted',
			reasons: [],
			decidedBy: 'a1'
		});
		const res = await recordDecision(db as never, {
			submissionId: subId,
			decision: 'rejected',
			reasons: ['x'],
			decidedBy: 'a2'
		});
		expect(res).toBe('already_decided');
		const row = sqlite.prepare(`SELECT decision FROM submissions WHERE id=?`).get(subId) as any;
		expect(row.decision).toBe('accepted');
	});

	it('resetDecision clears the decision and reverts status to ready for review', async () => {
		await recordDecision(db as never, {
			submissionId: subId,
			decision: 'accepted',
			reasons: [],
			decidedBy: 'a1'
		});
		await resetDecision(db as never, subId);
		const row = sqlite
			.prepare(
				`SELECT status, decision, decision_reasons, decided_by, decided_at FROM submissions WHERE id=?`
			)
			.get(subId) as any;
		expect(row.status).toBe('ready for review');
		expect(row.decision).toBeNull();
		expect(row.decision_reasons).toBeNull();
		expect(row.decided_by).toBeNull();
		expect(row.decided_at).toBeNull();
	});
});
