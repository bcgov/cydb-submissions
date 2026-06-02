import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as schema from '$lib/server/db/schema';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('submissions.searchIndexedAt', () => {
	it('defaults to null on insert and is writable', () => {
		const r = db
			.insert(schema.submissions)
			.values({ submissionUuid: randomUUID(), informationAccurate: true, dataSharingConsent: true, rawPayload: {} })
			.returning({ id: schema.submissions.id, idx: schema.submissions.searchIndexedAt })
			.all();
		expect(r[0].idx).toBeNull();

		db.update(schema.submissions)
			.set({ searchIndexedAt: '2026-06-02 10:00:00' })
			.where(eq(schema.submissions.id, r[0].id))
			.run();

		const after = db
			.select({ idx: schema.submissions.searchIndexedAt })
			.from(schema.submissions)
			.where(eq(schema.submissions.id, r[0].id))
			.get();
		expect(after!.idx).toBe('2026-06-02 10:00:00');
	});
});
