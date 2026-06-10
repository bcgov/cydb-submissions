import { describe, it, expect } from 'vitest';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';
import { parseBypassConfig, applyBypass } from '$lib/server/dev-bypass';
import { revokeRole } from '$lib/server/roles';

function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, {
		migrationsFolder: path.resolve(__dirname, '../../src/lib/server/db/migrations')
	});
	return { sqlite, db };
}

describe('parseBypassConfig', () => {
	it('returns null for empty / undefined', () => {
		expect(parseBypassConfig(undefined)).toBeNull();
		expect(parseBypassConfig('')).toBeNull();
	});

	it('parses a single email:role pair', () => {
		expect(parseBypassConfig('a@x:admin')).toEqual([{ email: 'a@x', roles: ['admin'] }]);
	});

	it('parses multiple identities separated by commas', () => {
		expect(parseBypassConfig('a@x:admin,b@y:cfd_worker,c@z:clinician')).toEqual([
			{ email: 'a@x', roles: ['admin'] },
			{ email: 'b@y', roles: ['cfd_worker'] },
			{ email: 'c@z', roles: ['clinician'] }
		]);
	});

	it('parses multiple roles per identity with +', () => {
		expect(parseBypassConfig('a@x:admin+cfd_worker')).toEqual([
			{ email: 'a@x', roles: ['admin', 'cfd_worker'] }
		]);
	});

	it('throws on an unknown role', () => {
		expect(() => parseBypassConfig('a@x:wizard')).toThrow(/unknown role/);
	});

	it('throws on a malformed entry', () => {
		expect(() => parseBypassConfig('not-a-pair')).toThrow(/malformed/);
	});
});

describe('applyBypass', () => {
	it('creates a synthetic user + role row on first invocation', async () => {
		const { sqlite, db } = freshDb();
		const result = await applyBypass(db as never, [{ email: 'a@x', roles: ['admin'] }], 'a@x');
		expect(result).not.toBeNull();
		expect(result!.user.email).toBe('a@x');
		const rolesRow = sqlite
			.prepare(`SELECT role FROM user_roles WHERE user_id = ?`)
			.all(result!.user.id);
		expect(rolesRow).toEqual([{ role: 'admin' }]);
	});

	it('is idempotent on repeated calls', async () => {
		const { sqlite, db } = freshDb();
		const id1 = (await applyBypass(db as never, [{ email: 'a@x', roles: ['admin'] }], 'a@x'))!.user
			.id;
		const id2 = (await applyBypass(db as never, [{ email: 'a@x', roles: ['admin'] }], 'a@x'))!.user
			.id;
		expect(id1).toBe(id2);
		const count = sqlite
			.prepare(`SELECT count(*) as n FROM user_roles WHERE user_id = ?`)
			.get(id1) as { n: number };
		expect(count.n).toBe(1);
	});

	it('returns null when the requested email is not in the configured identities', async () => {
		const { db } = freshDb();
		const result = await applyBypass(db as never, [{ email: 'a@x', roles: ['admin'] }], 'b@y');
		expect(result).toBeNull();
	});

	it('falls back to the first identity when no email is requested', async () => {
		const { db } = freshDb();
		const result = await applyBypass(db as never, [{ email: 'a@x', roles: ['admin'] }], undefined);
		expect(result?.user.email).toBe('a@x');
	});

	it('subtracts revoked roles from the bypass role set', async () => {
		const { db } = freshDb();
		const identities = parseBypassConfig('super@test.local:admin+cfd_worker')!;
		const first = await applyBypass(db as never, identities, 'super@test.local');
		expect(first!.roles).toEqual(new Set(['admin', 'cfd_worker']));
		await revokeRole(db as never, {
			userId: first!.user.id,
			role: 'admin',
			revokedBy: first!.user.id
		});
		const second = await applyBypass(db as never, identities, 'super@test.local');
		expect(second!.roles).toEqual(new Set(['cfd_worker']));
	});
});
