import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import * as schema from '$lib/server/db/schema';
import { InMemorySearchClient } from '$lib/server/search/stub';
import { indexSubmission } from '$lib/server/search/indexer';
import { buildStatusFilter, runSearch } from '$lib/server/search/query';

describe('buildStatusFilter', () => {
	it('maps view filter values to engine filters', () => {
		expect(buildStatusFilter('all')).toEqual({});
		expect(buildStatusFilter('exclude_invalid')).toEqual({ statusNotEquals: 'invalid' });
		expect(buildStatusFilter('submitted')).toEqual({ statusEquals: 'submitted' });
		expect(buildStatusFilter('invalid')).toEqual({ statusEquals: 'invalid' });
	});
});

let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

function seed(surname: string, ocr: string, status = 'submitted'): number {
	const sub = db.insert(schema.submissions).values({
		submissionUuid: `u-${surname}`, status, submitterSurname: surname,
		informationAccurate: true, dataSharingConsent: true, rawPayload: {}
	}).returning({ id: schema.submissions.id }).all();
	const id = sub[0].id;
	const att = db.insert(schema.submissionAttachments).values({
		submissionId: id, originalFilename: 'r.pdf', storedPath: '/r.pdf', sizeBytes: 1, mimeType: 'application/pdf', sha256: 'h'
	}).returning({ id: schema.submissionAttachments.id }).all();
	db.insert(schema.ocrResults).values({ attachmentId: att[0].id, rawText: ocr, modelId: 'stub', apiVersion: 'v1' }).run();
	return id;
}

describe('runSearch', () => {
	it('hydrates rows from SQLite in engine hit order with snippet + attachmentCount', async () => {
		const client = new InMemorySearchClient();
		const a = seed('Alpha', 'autism speech delay');
		const b = seed('Bravo', 'autism social interaction');
		await indexSubmission(db, client, a);
		await indexSubmission(db, client, b);

		const res = await runSearch(db, client, {
			query: 'autism', statusNotEquals: 'invalid', limit: 25, offset: 0, fuzzy: true, fuzzyDistance: 2
		});

		expect(res.total).toBe(2);
		expect(res.rows.map((r) => r.uuid)).toEqual(['u-Alpha', 'u-Bravo']); // stub orders by id
		expect(res.rows[0].surname).toBe('Alpha');
		expect(res.rows[0].attachmentCount).toBe(1);
		expect(res.rows[0].snippet).toContain('autism');
	});

	it('returns an empty result set when nothing matches', async () => {
		const client = new InMemorySearchClient();
		const a = seed('Alpha', 'autism');
		await indexSubmission(db, client, a);
		const res = await runSearch(db, client, { query: 'nonexistentterm', limit: 25, offset: 0, fuzzy: true, fuzzyDistance: 2 });
		expect(res.total).toBe(0);
		expect(res.rows).toEqual([]);
	});
});
