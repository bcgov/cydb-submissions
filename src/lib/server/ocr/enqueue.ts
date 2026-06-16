import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export function enqueueAttachments(db: Db, attachmentIds: number[]): void {
	if (attachmentIds.length === 0) {
		console.log('enqueueAttachments: no attachments provided');
		return;
	}
	const rows = attachmentIds.map((id) => ({ attachmentId: id, status: 'queued' as const }));
	db.insert(schema.ocrJobs).values(rows).run();
}
