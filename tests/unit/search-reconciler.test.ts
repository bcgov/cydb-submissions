import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import * as schema from '$lib/server/db/schema';
import { InMemorySearchClient } from '$lib/server/search/stub';
import { selectDirty, reconcileOnce } from '$lib/server/search/reconciler';

let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

function seed(surname: string): number {
	return db.insert(schema.submissions).values({
		submissionUuid: `u-${surname}`, status: 'submitted', submitterSurname: surname,
		informationAccurate: true, dataSharingConsent: true, rawPayload: {}
	}).returning({ id: schema.submissions.id }).all()[0].id;
}

describe('selectDirty', () => {
	it('returns rows that have never been indexed', () => {
		const a = seed('A');
		expect(selectDirty(db, 50)).toContain(a);
	});
});

describe('reconcileOnce', () => {
	it('indexes all dirty rows and clears them from the dirty set', async () => {
		const client = new InMemorySearchClient();
		seed('A'); seed('B');
		const n = await reconcileOnce(db, client, 50);
		expect(n).toBe(2);
		expect(selectDirty(db, 50)).toEqual([]);
		const r = await client.search({ match: 'A', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.total).toBeGreaterThanOrEqual(1);
	});
});
