import { sql } from 'drizzle-orm';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DrizzleDb } from './roles';

export async function dbPing(db: DrizzleDb): Promise<boolean> {
	try {
		await db.run(sql`SELECT 1`);
		return true;
	} catch {
		return false;
	}
}

export function attachmentsDirOk(dir: string): boolean {
	try {
		mkdirSync(dir, { recursive: true });
		const probe = path.join(dir, '.health-' + process.pid);
		writeFileSync(probe, '');
		unlinkSync(probe);
		return true;
	} catch {
		return false;
	}
}

export function authConfigured(secret: string | undefined): boolean {
	return Boolean(secret && secret.length >= 32);
}
