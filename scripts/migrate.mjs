#!/usr/bin/env node
// Apply pending Drizzle migrations against process.env.DATABASE_URL
// before the server starts. Safe to run repeatedly; drizzle tracks
// applied migrations in __drizzle_migrations.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const here = path.dirname(fileURLToPath(import.meta.url));

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('migrate: DATABASE_URL is not set; skipping migrations.');
	process.exit(0);
}

// In a built container the migrations directory is colocated with this
// script under /app/migrations. Locally during development the canonical
// location is under src/lib/server/db/migrations. Try both.
const candidates = [
	path.resolve(here, '../migrations'),
	path.resolve(here, '../src/lib/server/db/migrations')
];
const migrationsFolder = candidates.find((p) => existsSync(p));

if (!migrationsFolder) {
	console.error(`migrate: could not find migrations folder; tried ${candidates.join(', ')}`);
	process.exit(1);
}

console.log(`migrate: applying migrations from ${migrationsFolder} to ${dbUrl}`);
const sqlite = new Database(dbUrl);
sqlite.pragma('foreign_keys = OFF');
try {
	migrate(drizzle(sqlite), { migrationsFolder });
	console.log('migrate: done');
} catch (e) {
	console.error('migrate: failed with error');
	console.error(e);
} finally {
	sqlite.pragma('foreign_keys = ON')
	sqlite.close();
}

