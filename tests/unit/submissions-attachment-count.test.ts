import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { inArray, sql } from 'drizzle-orm';
import path from 'node:path';
import * as schema from '$lib/server/db/schema';

let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

function seed(uuid: string, attachments: number): number {
	const id = db
		.insert(schema.submissions)
		.values({
			submissionUuid: uuid,
			childYouthFirstName: 'Test',
			childYouthLastName: 'User',
			childYouthDob: '2015-01-01',
			childYouthGender: 'nonBinaryPerson',
			signatoryFirstName: 'Parent',
			signatoryLastName: 'User',
			signatoryDob: '1985-01-01',
			signatoryGender: 'womanGirl',
			signatoryRelationship: 'Parent',
			primaryPhone: '250-555-0000',
			email: 'test@example.com',
			screening: 'Yes',
			primaryCareAndControl: true,
			signature: 'sig',
			dateSigned: '2026-06-01',
			rawPayload: {}
		})
		.returning({ id: schema.submissions.id })
		.all()[0].id;
	for (let i = 0; i < attachments; i++) {
		db.insert(schema.submissionAttachments)
			.values({
				submissionId: id,
				originalFilename: 'f',
				storedPath: '/f' + id + '-' + i,
				sizeBytes: 1,
				mimeType: 'application/pdf',
				sha256: 'h' + id + '-' + i
			})
			.run();
	}
	return id;
}

describe('submissions attachment-count correlated subquery', () => {
	it('returns the correct per-row attachment count (not the grand total)', () => {
		const a = seed('A', 1);
		const b = seed('B', 3);
		const attachmentCountExpr = sql<number>`(
			SELECT count(*) FROM submission_attachments WHERE submission_id = "submissions"."id"
		)`;
		const rows = db
			.select({ id: schema.submissions.id, n: attachmentCountExpr })
			.from(schema.submissions)
			.where(inArray(schema.submissions.id, [a, b]))
			.all();
		const byId = new Map(rows.map((r) => [r.id, Number(r.n)]));
		expect(byId.get(a)).toBe(1);
		expect(byId.get(b)).toBe(3);
	});
});
