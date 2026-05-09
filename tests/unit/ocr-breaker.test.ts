import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { Breaker } from '$lib/server/ocr/breaker';
import { LogMailer } from '$lib/server/mail/mailer-log';
import { getSystemState } from '$lib/server/ocr/system-state';
import { createLogger } from '$lib/server/log';
import path from 'node:path';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: path.resolve('src/lib/server/db/migrations') });
});

describe('Breaker', () => {
	it('does not trip below threshold', async () => {
		const log = createLogger({ level: 'silent' });
		const b = new Breaker({
			db,
			mailer: new LogMailer(log),
			logger: log,
			threshold: 4,
			recipients: ['ops@test'],
			from: 'cydb@test'
		});
		await b.recordFailure({ jobId: 1, errorClass: 'X' });
		await b.recordFailure({ jobId: 2, errorClass: 'X' });
		expect(b.isTripped()).toBe(false);
		expect(getSystemState(db, 'ocr.halted')).toBeNull();
	});

	it('trips at threshold and writes the sentinel', async () => {
		const log = createLogger({ level: 'silent' });
		const b = new Breaker({
			db,
			mailer: new LogMailer(log),
			logger: log,
			threshold: 4,
			recipients: ['ops@test'],
			from: 'cydb@test'
		});
		for (let i = 0; i < 4; i++) await b.recordFailure({ jobId: i, errorClass: 'X' });
		expect(b.isTripped()).toBe(true);
		const state = getSystemState<{ jobIds: number[] }>(db, 'ocr.halted');
		expect(state?.jobIds).toEqual([0, 1, 2, 3]);
	});

	it('recordSuccess resets the counter', async () => {
		const log = createLogger({ level: 'silent' });
		const b = new Breaker({
			db,
			mailer: new LogMailer(log),
			logger: log,
			threshold: 4,
			recipients: [],
			from: 'cydb@test'
		});
		await b.recordFailure({ jobId: 1, errorClass: 'X' });
		await b.recordFailure({ jobId: 2, errorClass: 'X' });
		b.recordSuccess();
		await b.recordFailure({ jobId: 3, errorClass: 'X' });
		expect(b.isTripped()).toBe(false);
	});

	it('clear() clears the sentinel and resets the counter', async () => {
		const log = createLogger({ level: 'silent' });
		const b = new Breaker({
			db,
			mailer: new LogMailer(log),
			logger: log,
			threshold: 2,
			recipients: [],
			from: 'cydb@test'
		});
		await b.recordFailure({ jobId: 1, errorClass: 'X' });
		await b.recordFailure({ jobId: 2, errorClass: 'X' });
		expect(b.isTripped()).toBe(true);
		b.clear();
		expect(b.isTripped()).toBe(false);
		expect(getSystemState(db, 'ocr.halted')).toBeNull();
	});

	it('does not double-trip — second recordFailure after trip is a no-op for the sentinel', async () => {
		const log = createLogger({ level: 'silent' });
		const sends: unknown[] = [];
		const mailer = { send: async (m: unknown) => { sends.push(m); } };
		const b = new Breaker({
			db,
			mailer,
			logger: log,
			threshold: 2,
			recipients: ['ops@test'],
			from: 'cydb@test'
		});
		await b.recordFailure({ jobId: 1, errorClass: 'X' });
		await b.recordFailure({ jobId: 2, errorClass: 'X' });
		expect(sends).toHaveLength(1);
		await b.recordFailure({ jobId: 3, errorClass: 'X' });
		expect(sends).toHaveLength(1); // still one
	});

	it('rehydrates as tripped from a pre-existing halt sentinel', async () => {
		const log = createLogger({ level: 'silent' });
		const b1 = new Breaker({
			db,
			mailer: new LogMailer(log),
			logger: log,
			threshold: 2,
			recipients: [],
			from: 'cydb@test'
		});
		await b1.recordFailure({ jobId: 1, errorClass: 'X' });
		await b1.recordFailure({ jobId: 2, errorClass: 'X' });

		// Construct a fresh Breaker against the same DB
		const b2 = new Breaker({
			db,
			mailer: new LogMailer(log),
			logger: log,
			threshold: 2,
			recipients: [],
			from: 'cydb@test'
		});
		expect(b2.isTripped()).toBe(true);
	});
});
