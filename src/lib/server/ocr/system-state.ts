import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export function getSystemState<T = unknown>(db: Db, key: string): T | null {
	const row = db.select().from(schema.systemState).where(eq(schema.systemState.key, key)).get();
	if (!row) return null;
	return JSON.parse(row.value) as T;
}

export function setSystemState(db: Db, key: string, value: unknown): void {
	const json = JSON.stringify(value);
	db.insert(schema.systemState)
		.values({ key, value: json })
		.onConflictDoUpdate({ target: schema.systemState.key, set: { value: json } })
		.run();
}

export function clearSystemState(db: Db, key: string): void {
	db.delete(schema.systemState).where(eq(schema.systemState.key, key)).run();
}
