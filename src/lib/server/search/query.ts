import { inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import type { StatusFilter } from '../sort';
import type { SearchClient } from './types';

type Db = BetterSQLite3Database<typeof schema>;

export interface StatusEngineFilter {
	statusEquals?: string;
	statusNotEquals?: string;
	/** Also query the invalid_submissions_idx and merge results. */
	includeInvalidIndex?: boolean;
}

/** Translate the view's status-filter chip into an engine attribute filter. */
export function buildStatusFilter(statusFilter: StatusFilter): StatusEngineFilter {
	if (statusFilter === 'all') return { includeInvalidIndex: true };
	if (statusFilter === 'exclude_invalid') return { statusNotEquals: 'invalid' };
	if (statusFilter === 'invalid') return { statusEquals: 'invalid', includeInvalidIndex: true };
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
	childYouthFirstName: string;
	childYouthLastName: string;
	screening: string;
	assessments: Array<{
		assessmentType: string;
		completedBy: string;
		dateOfAssessment: string;
		attachmentName: string;
	}> | null;
	submittedAt: string;
	status: string;
	attachmentCount: number | string;
	snippet: string;
	/** True when this row comes from invalid_submissions rather than submissions. */
	isInvalidSubmission: boolean;
	category1: number | string;
	category2: number | string;
	category3: number | string;
	category4: number | string;
	category5: number | string;
	category6: number | string;
	category7: number | string;
	category8: number | string;
	category9: number | string;
	category10: number | string;
	category11: number | string;
	category12: number | string;
	category13: number | string;
	total: number | string;
}

export interface RunSearchResult {
	rows: SearchRow[];
	total: number;
}

/**
 * Run a search against the engine, then hydrate the matching rows from SQLite
 * (the source of truth) preserving relevance order. Throws SearchQueryError on
 * a malformed query (propagated from the client).
 *
 * When includeInvalidIndex is set, also searches invalid_submissions_idx and
 * merges results by score. The two indexes are searched with the same
 * candidate window (offset=0, limit=offset+limit) then merged and re-paginated,
 * which is accurate for typical page sizes and low invalid-submission counts.
 */
export async function runSearch(
	db: Db,
	client: SearchClient,
	opts: RunSearchOptions
): Promise<RunSearchResult> {
	// Status is filtered at the engine (statusEquals/NotEquals) AND every row is
	// re-hydrated from SQLite below, where its TRUE current status is read for display.
	// A briefly-stale index status entry self-heals via the reconciler. Phase-2
	// hardening (once reviewer status actions exist): re-apply the status predicate to
	// the hydrated rows as defence-in-depth.
	const searchOpts = {
		match: opts.query,
		statusEquals: opts.statusEquals,
		statusNotEquals: opts.statusNotEquals,
		limit: opts.limit,
		offset: opts.offset,
		fuzzy: opts.fuzzy,
		fuzzyDistance: opts.fuzzyDistance
	};

	const [regularResult, invalidResult] = await Promise.all([
		client.search(searchOpts),
		opts.includeInvalidIndex ? client.searchInvalid(searchOpts) : Promise.resolve({ hits: [], total: 0 })
	]);

	// Merge hits from both indexes, tagging source, then sort by weight desc.
	type TaggedHit = { id: number; weight: number; snippet: string; source: 'regular' | 'invalid' };
	const combined: TaggedHit[] = [
		...regularResult.hits.map((h) => ({ ...h, source: 'regular' as const })),
		...invalidResult.hits.map((h) => ({ ...h, source: 'invalid' as const }))
	].sort((a, b) => b.weight - a.weight);

	const pageHits = combined.slice(opts.offset, opts.offset + opts.limit);
	const total = regularResult.total + invalidResult.total;

	if (pageHits.length === 0) return { rows: [], total };

	const regularHits = pageHits.filter((h) => h.source === 'regular');
	const invalidHits = pageHits.filter((h) => h.source === 'invalid');

	// "submissions"."id" MUST be a quoted literal here, not ${schema.submissions.id}.
	// Drizzle renders the column-ref form as an unqualified "id" inside this subquery,
	// which SQLite mis-resolves to submission_attachments, yielding wrong counts.
	const attachmentCountExpr = sql<number>`(
		SELECT count(*) FROM submission_attachments WHERE submission_id = "submissions"."id"
	)`;

	function categoryExpr(n: number) {
		const col = sql.raw(`category${n}`);
		return sql<number>`(
			SELECT COALESCE(SUM("keyword_hits"."count"), 0)
			FROM keyword_hits WHERE keyword_hits.submission_id = "submissions"."id"
			AND ${col} >= 1)`;
	}

	const totalExpr = sql<number>`(
		SELECT COALESCE(SUM(
			(CASE WHEN category1  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category2  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category3  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category4  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category5  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category6  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category7  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category8  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category9  >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category10 >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category11 >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category12 >= 1 THEN "count" ELSE 0 END) +
			(CASE WHEN category13 >= 1 THEN "count" ELSE 0 END)
		), 0)
		FROM keyword_hits WHERE keyword_hits.submission_id = "submissions"."id"
	)`;

	const [fetchedRegular, fetchedInvalid] = await Promise.all([
		regularHits.length
			? db
					.select({
						id: schema.submissions.id,
						uuid: schema.submissions.submissionUuid,
						surname: schema.submissions.submitterSurname,
						childYouthFirstName: schema.submissions.childYouthFirstName,
						childYouthLastName: schema.submissions.childYouthLastName,
						screening: schema.submissions.screening,
						assessments: schema.submissions.assessments,
						submittedAt: schema.submissions.createdAt,
						status: schema.submissions.status,
						attachmentCount: attachmentCountExpr,
						category1: categoryExpr(1),
						category2: categoryExpr(2),
						category3: categoryExpr(3),
						category4: categoryExpr(4),
						category5: categoryExpr(5),
						category6: categoryExpr(6),
						category7: categoryExpr(7),
						category8: categoryExpr(8),
						category9: categoryExpr(9),
						category10: categoryExpr(10),
						category11: categoryExpr(11),
						category12: categoryExpr(12),
						category13: categoryExpr(13),
						total: totalExpr
					})
					.from(schema.submissions)
					.where(inArray(schema.submissions.id, regularHits.map((h) => h.id)))
					.all()
			: Promise.resolve([]),
		invalidHits.length
			? db
					.select({
						id: schema.invalidSubmissions.id,
						uuid: schema.invalidSubmissions.submissionUuid,
						receivedAt: schema.invalidSubmissions.receivedAt,
						surname: sql<string | null>`json_extract(${schema.invalidSubmissions.rawPayload}, '$.agreementSignatorysLegalLastName')`,
						childYouthFirstName: sql<string | null>`json_extract(${schema.invalidSubmissions.rawPayload}, '$.childYouthsFirstName')`,
						childYouthLastName: sql<string | null>`json_extract(${schema.invalidSubmissions.rawPayload}, '$.childYouthsLegalLastName')`,
						screening: sql<string | null>`json_extract(${schema.invalidSubmissions.rawPayload}, '$.screening')`,
						assessmentsJson: sql<string | null>`json_extract(${schema.invalidSubmissions.rawPayload}, '$.editGrid')`
					})
					.from(schema.invalidSubmissions)
					.where(inArray(schema.invalidSubmissions.id, invalidHits.map((h) => h.id)))
					.all()
			: Promise.resolve([])
	]);

	const regularById = new Map(fetchedRegular.map((r) => [r.id, r]));
	const invalidById = new Map(fetchedInvalid.map((r) => [r.id, r]));
	const snippetById = new Map(pageHits.map((h) => [`${h.source}:${h.id}`, h.snippet]));

	const rows: SearchRow[] = [];
	for (const hit of pageHits) {
		const snippet = snippetById.get(`${hit.source}:${hit.id}`) ?? '';
		if (hit.source === 'regular') {
			const r = regularById.get(hit.id);
			if (!r) continue;
			rows.push({
				uuid: r.uuid,
				surname: r.surname,
				childYouthFirstName: r.childYouthFirstName,
				childYouthLastName: r.childYouthLastName,
				screening: r.screening,
				assessments: r.assessments,
				submittedAt: r.submittedAt,
				status: r.status,
				attachmentCount: Number(r.attachmentCount),
				snippet,
				isInvalidSubmission: false,
				category1: Number(r.category1),
				category2: Number(r.category2),
				category3: Number(r.category3),
				category4: Number(r.category4),
				category5: Number(r.category5),
				category6: Number(r.category6),
				category7: Number(r.category7),
				category8: Number(r.category8),
				category9: Number(r.category9),
				category10: Number(r.category10),
				category11: Number(r.category11),
				category12: Number(r.category12),
				category13: Number(r.category13),
				total: Number(r.total)
			});
		} else {
			const r = invalidById.get(hit.id);
			if (!r) continue;
			const assessments: SearchRow['assessments'] = null;
			let raw: unknown;
			try {
				if (r.assessmentsJson) {
					raw = JSON.parse(r.assessmentsJson);
				}
			} catch { /* malformed payload — leave as empty array */ }
			rows.push({
				uuid: r.uuid,
				surname: r.surname ?? '—',
				childYouthFirstName: r.childYouthFirstName ?? '—',
				childYouthLastName: r.childYouthLastName === '—' && r.childYouthFirstName === '—' ? '': r.childYouthLastName ?? '',
				screening: r.screening ?? '—',
				assessments,
				submittedAt: r.receivedAt,
				status: 'invalid',
				attachmentCount: Array.isArray(raw) ? (raw.length > 0 ? raw.length : '—') : '—',
				snippet,
				isInvalidSubmission: true,
				category1: '—', category2: '—', category3: '—', category4: '—', category5: '—',
				category6: '—', category7: '—', category8: '—', category9: '—', category10: '—',
				category11: '—', category12: '—', category13: '—', total: '—'
			});
		}
	}
	return { rows, total };
}
