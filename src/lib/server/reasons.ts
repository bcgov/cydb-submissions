import { asc, eq, sql } from 'drizzle-orm';
import { rejectionReasons } from './db/schema';
import type { DrizzleDb } from './roles';

export interface Reason {
	id: number;
	text: string;
	active: boolean;
}

export async function listActiveReasons(
	db: DrizzleDb
): Promise<Array<{ id: number; text: string }>> {
	return db
		.select({ id: rejectionReasons.id, text: rejectionReasons.text })
		.from(rejectionReasons)
		.where(eq(rejectionReasons.active, true))
		.orderBy(asc(rejectionReasons.id));
}

export async function listAllReasons(db: DrizzleDb): Promise<Reason[]> {
	return db
		.select({
			id: rejectionReasons.id,
			text: rejectionReasons.text,
			active: rejectionReasons.active
		})
		.from(rejectionReasons)
		.orderBy(asc(rejectionReasons.id));
}

export async function addReason(db: DrizzleDb, text: string): Promise<void> {
	await db.insert(rejectionReasons).values({ text });
}

export async function editReason(db: DrizzleDb, id: number, text: string): Promise<void> {
	await db
		.update(rejectionReasons)
		.set({ text, updatedAt: sql`CURRENT_TIMESTAMP` })
		.where(eq(rejectionReasons.id, id));
}

export async function setReasonActive(db: DrizzleDb, id: number, active: boolean): Promise<void> {
	await db
		.update(rejectionReasons)
		.set({ active, updatedAt: sql`CURRENT_TIMESTAMP` })
		.where(eq(rejectionReasons.id, id));
}
