#!/usr/bin/env node
// Idempotent admin bootstrap. Runs after migrations on container start.
// Uses better-auth's signUpEmail to keep password hashing identical to runtime.
//
// Schema definitions are inlined here (mirroring src/lib/server/db/auth.schema.ts)
// because this script runs in pure Node — it can't import .ts modules directly.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id').notNull()
});

const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

const authSchema = { user, session, account, verification };

/**
 * @param {{
 *   db: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<any>;
 *   email: string;
 *   password: string;
 *   secret: string;
 *   baseURL?: string;
 * }} opts
 */
export async function seedAdmin({ db, email, password, secret, baseURL = 'http://localhost' }) {
	const countRow = /** @type {{ count: number } | undefined} */ (
		(await db.all(sql`SELECT count(*) as count FROM "user"`))[0]
	);
	const count = Number(countRow?.count ?? 0);
	if (count > 0) return { skipped: true, reason: 'users already exist' };

	const auth = betterAuth({
		baseURL,
		secret,
		database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
		emailAndPassword: { enabled: true, autoSignIn: false }
	});
	await auth.api.signUpEmail({
		body: { email, password, name: email.split('@')[0] }
	});
	const created = /** @type {{ id: string } | undefined} */ (
		(await db.all(sql`SELECT id FROM "user" WHERE email = ${email}`))[0]
	);
	if (!created) return { skipped: false, error: 'user creation did not persist' };
	await db.run(sql`INSERT INTO user_roles (user_id, role) VALUES (${created.id}, 'admin')`);
	return { skipped: false, id: created.id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const dbUrl = process.env.DATABASE_URL;
	const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
	const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!dbUrl || !email || !password || !secret) {
		console.log('seed-admin: env not configured; skipping.');
		process.exit(0);
	}
	const sqlite = new Database(dbUrl);
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema: authSchema });
	const result = await seedAdmin({
		db,
		email,
		password,
		secret,
		baseURL: process.env.ORIGIN ?? 'http://localhost'
	});
	console.log('seed-admin:', result);
	sqlite.close();
}
