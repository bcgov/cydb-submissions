import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { buildInvalidSearchDocument } from './invalid-document';
import type { SearchClient } from './types';

type Db = BetterSQLite3Database<typeof schema>;

export async function indexInvalidSubmission(
	db: Db,
	client: SearchClient,
	id: number
): Promise<boolean> {
	const row = db
		.select()
		.from(schema.invalidSubmissions)
		.where(eq(schema.invalidSubmissions.id, id))
		.get();
	if (!row) return false;

	const doc = buildInvalidSearchDocument(row);
	await client.replaceInvalidDoc(doc);

	db.update(schema.invalidSubmissions)
		.set({ searchIndexedAt: sql`CURRENT_TIMESTAMP` })
		.where(eq(schema.invalidSubmissions.id, id))
		.run();
	return true;
}

export async function deleteInvalidSubmission(client: SearchClient, id: number): Promise<void> {
	await client.deleteInvalidDoc(id);
}
