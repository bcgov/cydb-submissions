import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import {
	listActiveReasons,
	listAllReasons,
	addReason,
	editReason,
	setReasonActive
} from '$lib/server/reasons';

describe('rejection_reasons CRUD', () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeEach(() => {
		sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys = ON');
		db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });
		sqlite.exec(`DELETE FROM rejection_reasons`); // clear migration seed for deterministic assertions
	});
	afterEach(() => sqlite.close());

	it('add + listActiveReasons returns active rows ordered by id (insertion order)', async () => {
		await addReason(db as never, 'Beta');
		await addReason(db as never, 'Alpha');
		const active = await listActiveReasons(db as never);
		expect(active.map((r) => r.text)).toEqual(['Beta', 'Alpha']);
	});
	it('editReason changes text without touching active', async () => {
		await addReason(db as never, 'Old');
		const [r] = await listActiveReasons(db as never);
		await editReason(db as never, r.id, 'New');
		expect((await listActiveReasons(db as never))[0].text).toBe('New');
	});
	it('setReasonActive(false) hides from active but keeps in listAll; reactivating restores', async () => {
		await addReason(db as never, 'Hideme');
		const [r] = await listActiveReasons(db as never);
		await setReasonActive(db as never, r.id, false);
		expect(await listActiveReasons(db as never)).toHaveLength(0);
		expect(await listAllReasons(db as never)).toHaveLength(1);
		await setReasonActive(db as never, r.id, true);
		expect(await listActiveReasons(db as never)).toHaveLength(1);
	});
});
