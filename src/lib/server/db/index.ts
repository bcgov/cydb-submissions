import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _sqlite: Database.Database | null = null;
let _db: DrizzleDb | null = null;

function ensure(): DrizzleDb {
	if (_db) return _db;
	if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	_sqlite = new Database(env.DATABASE_URL);
	_sqlite.pragma('journal_mode = WAL');
	_sqlite.pragma('foreign_keys = ON');
	_db = drizzle(_sqlite, { schema });
	return _db;
}

// Proxy so the connection is opened lazily on first use, not at module load.
// This lets `vite build` analyse server modules without a DB env.
export const db = new Proxy({} as DrizzleDb, {
	get(_target, prop, receiver) {
		const target = ensure();
		const value = Reflect.get(target, prop, receiver);
		return typeof value === 'function' ? value.bind(target) : value;
	}
});

export function sqlite(): Database.Database {
	ensure();
	return _sqlite!;
}
