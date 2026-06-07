import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import * as schema from '$lib/server/db/schema';
import { InMemorySearchClient } from '$lib/server/search/stub';
import { indexSubmission, deleteSubmission } from '$lib/server/search/indexer';

let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

const SEED_DEFAULTS = {
	childYouthFirstName: 'Jordan',
	childYouthLastName: 'Okafor',
	childYouthDob: '2018-04-12',
	childYouthGender: 'nonBinaryPerson',
	signatoryFirstName: 'Alex',
	signatoryLastName: 'Okafor',
	signatoryDob: '1985-06-01',
	signatoryGender: 'womanGirl',
	signatoryRelationship: 'Parent',
	primaryPhone: '604-555-0100',
	email: 'alex@example.com',
	screening: 'Yes',
	primaryCareAndControl: true,
	signature: 'Alex Okafor',
	dateSigned: '2026-05-01',
	rawPayload: {}
};

function seedFull(): number {
	const sub = db
		.insert(schema.submissions)
		.values({
			submissionUuid: 'u-1',
			status: 'OCR processed',
			submitterSurname: 'Okafor',
			...SEED_DEFAULTS,
			assessments: [
				{
					assessmentType: 'Vineland Adaptive Behavior Scales',
					completedBy: 'Psychologist',
					dateOfAssessment: '2024-09-10',
					attachmentName: 'vineland.pdf'
				}
			]
		})
		.returning({ id: schema.submissions.id })
		.all();
	const id = sub[0].id;
	const att = db
		.insert(schema.submissionAttachments)
		.values({
			submissionId: id,
			originalFilename: 'r.pdf',
			storedPath: '/r.pdf',
			sizeBytes: 1,
			mimeType: 'application/pdf',
			sha256: 'h'
		})
		.returning({ id: schema.submissionAttachments.id })
		.all();
	db.insert(schema.ocrResults)
		.values({
			attachmentId: att[0].id,
			rawText: 'autism speech delay noted',
			modelId: 'stub',
			apiVersion: 'v1'
		})
		.run();
	db.insert(schema.submissionMetadata).values({ submissionId: id, userAgent: 'Mozilla/5.0' }).run();
	return id;
}

describe('indexSubmission', () => {
	it('joins OCR + metadata, pushes a document, and stamps search_indexed_at', async () => {
		const client = new InMemorySearchClient();
		const id = seedFull();
		await indexSubmission(db, client, id);

		const r = await client.search({
			match: 'autism',
			limit: 10,
			offset: 0,
			fuzzy: false,
			fuzzyDistance: 2
		});
		expect(r.hits.map((h) => h.id)).toEqual([id]);
		// assessment type is indexed in structuredText
		const byTool = await client.search({
			match: 'Vineland',
			limit: 10,
			offset: 0,
			fuzzy: false,
			fuzzyDistance: 2
		});
		expect(byTool.hits.map((h) => h.id)).toEqual([id]);

		const byMeta = await client.search({
			match: 'Mozilla',
			limit: 10,
			offset: 0,
			fuzzy: false,
			fuzzyDistance: 2
		});
		expect(byMeta.hits.map((h) => h.id)).toEqual([id]);

		const stamped = db
			.select({ idx: schema.submissions.searchIndexedAt })
			.from(schema.submissions)
			.where(eq(schema.submissions.id, id))
			.get();
		expect(stamped!.idx).not.toBeNull();
	});

	it('returns false and does not stamp when the submission is missing', async () => {
		const client = new InMemorySearchClient();
		const ok = await indexSubmission(db, client, 999);
		expect(ok).toBe(false);
	});
});

describe('deleteSubmission', () => {
	it('removes the doc from the index', async () => {
		const client = new InMemorySearchClient();
		const id = seedFull();
		await indexSubmission(db, client, id);
		await deleteSubmission(client, id);
		const r = await client.search({
			match: 'autism',
			limit: 10,
			offset: 0,
			fuzzy: false,
			fuzzyDistance: 2
		});
		expect(r.total).toBe(0);
	});
});
