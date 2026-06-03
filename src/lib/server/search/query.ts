import { inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import type { StatusFilter } from '../sort';
import type { SearchClient } from './types';

type Db = BetterSQLite3Database<typeof schema>;

export interface StatusEngineFilter {
	statusEquals?: string;
	statusNotEquals?: string;
}

/** Translate the view's status-filter chip into an engine attribute filter. */
export function buildStatusFilter(statusFilter: StatusFilter): StatusEngineFilter {
	if (statusFilter === 'all') return {};
	if (statusFilter === 'exclude_invalid') return { statusNotEquals: 'invalid' };
	return { statusEquals: statusFilter };
}

export interface RunSearchOptions extends StatusEngineFilter {
	query: string;
	limit: number;
	offset: number;
	fuzzy: boolean;
	fuzzyDistance: number;
}

export interface SearchRow {
	uuid: string;
	surname: string | null;
	submittedAt: string;
	status: string;
	attachmentCount: number;
	snippet: string;
}

export interface RunSearchResult {
	rows: SearchRow[];
	total: number;
}

/**
 * Run a search against the engine, then hydrate the matching rows from SQLite
 * (the source of truth) preserving relevance order. Throws SearchQueryError on
 * a malformed query (propagated from the client).
 */
export async function runSearch(db: Db, client: SearchClient, opts: RunSearchOptions): Promise<RunSearchResult> {
	// Status is filtered at the engine (statusEquals/NotEquals) AND every row is
	// re-hydrated from SQLite below, where its TRUE current status is read for display.
	// A briefly-stale index status entry self-heals via the reconciler. Phase-2
	// hardening (once reviewer status actions exist): re-apply the status predicate to
	// the hydrated rows as defence-in-depth.
	const result = await client.search({
		match: opts.query,
		statusEquals: opts.statusEquals,
		statusNotEquals: opts.statusNotEquals,
		limit: opts.limit,
		offset: opts.offset,
		fuzzy: opts.fuzzy,
		fuzzyDistance: opts.fuzzyDistance
	});
	if (result.hits.length === 0) return { rows: [], total: result.total };

	const ids = result.hits.map((h) => h.id);
	const snippetById = new Map(result.hits.map((h) => [h.id, h.snippet]));

	// "submissions"."id" MUST be a quoted literal here, not ${schema.submissions.id}.
	// Drizzle renders the column-ref form as an unqualified "id" inside this subquery,
	// which SQLite mis-resolves to submission_attachments, yielding wrong counts.
	const attachmentCountExpr = sql<number>`(
		SELECT count(*) FROM submission_attachments WHERE submission_id = "submissions"."id"
	)`;

	const fetched = db
		.select({
			id: schema.submissions.id,
			uuid: schema.submissions.submissionUuid,
			surname: schema.submissions.submitterSurname,
			submittedAt: schema.submissions.createdAt,
			status: schema.submissions.status,
			attachmentCount: attachmentCountExpr
		})
		.from(schema.submissions)
		.where(inArray(schema.submissions.id, ids))
		.all();

	const byId = new Map(fetched.map((r) => [r.id, r]));
	const rows: SearchRow[] = [];
	for (const id of ids) {
		const r = byId.get(id);
		if (!r) continue; // row deleted between index and hydrate; skip
		rows.push({
			uuid: r.uuid,
			surname: r.surname,
			submittedAt: r.submittedAt,
			status: r.status,
			attachmentCount: Number(r.attachmentCount),
			snippet: snippetById.get(id) ?? ''
		});
	}
	return { rows, total: result.total };
}
