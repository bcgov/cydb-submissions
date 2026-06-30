import type { PageServerLoad } from './$types';
import { sql, eq, desc, asc, ne, count, and, notInArray, SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { submissions, invalidSubmissions } from '$lib/server/db/schema';
import { parseSubmissionsQuery } from '$lib/server/sort';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { getSearchClient } from '$lib/server/search/instance';
import { runSearch, buildStatusFilter } from '$lib/server/search/query';
import { SearchQueryError } from '$lib/server/search/types';
import { getCategoryMapping } from '$lib/server/ocr/keywords';
import { WORKER_BLOCKED_STATUSES } from '$lib/server/security/attachment-scope';

export const load: PageServerLoad = async ({ url, locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
	const isAdmin = locals.roles.has('admin');
	const categoryMap = await getCategoryMapping();
	const q = parseSubmissionsQuery(url);

	if (q.q) {
		auditLog(
			'submission_searched',
			{
				actorUserId: locals.user!.id,
				actorRole: [...locals.roles][0],
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		try {
			const result = await runSearch(db, getSearchClient(), {
				query: q.q,
				...buildStatusFilter(q.statusFilter),
				limit: q.size,
				offset: (q.page - 1) * q.size,
				fuzzy: true,
				fuzzyDistance: 2,
				sort: q.sort,
				order: q.order
			});
			if (!isAdmin) {
				result.rows = result.rows.filter(
					(r) => !WORKER_BLOCKED_STATUSES.includes(r.status as never)
				);
				result.total = result.rows.length;
			}
			return {
				rows: result.rows,
				invalidRows: [] as { 
					uuid: string; receivedAt: string; validationErrors: unknown; ipAddress: string | null;
					childYouthFirstName: string; childYouthLastName: string; surname: string; screening: string; 
					assessments: number; attachmentCount: number | string;
				}[],
				total: result.total,
				query: q,
				totalPages: Math.max(1, Math.ceil(result.total / q.size)),
				searchError: null as string | null,
				categoryMap
			};
		} catch (e) {
			if (e instanceof SearchQueryError) {
				return {
					rows: [],
					invalidRows: [] as { 
						uuid: string; receivedAt: string; validationErrors: unknown; ipAddress: string | null;
						childYouthFirstName: string; childYouthLastName: string; surname: string; screening: string; assessments: number;
					}[],
					total: 0,
					query: q,
					totalPages: 1,
					searchError: e.message,
					categoryMap
				};
			}
			throw e;
		}
	}

	const filterClause =
		q.statusFilter === 'all'
			? undefined
			: q.statusFilter === 'exclude_invalid'
				? ne(submissions.status, 'invalid')
				  : q.statusFilter === 'ocr_processed'
				   ? eq(submissions.status, 'OCR processed')
					: eq(submissions.status, q.statusFilter);

	const workerRestriction = !isAdmin
		? notInArray(submissions.status, WORKER_BLOCKED_STATUSES)
		: undefined;

	const effectiveFilter =
		workerRestriction && filterClause
			? and(filterClause, workerRestriction)
			: workerRestriction ?? filterClause;

	// "submissions"."id" MUST be a quoted literal here, not ${submissions.id}.
	// Drizzle renders the column-ref form as an unqualified "id" inside this subquery,
	// which SQLite mis-resolves to submission_attachments, yielding wrong counts.
	const attachmentCountExpr = sql<number>`(
		SELECT count(*) FROM submission_attachments WHERE submission_id = "submissions"."id"
	)`;

	function createCategorySQLStatement(categoryNumber: string): SQL<number> {
		const name = sql.raw(`category${categoryNumber}`);
		const sqlout = sql<number>`(
			SELECT COALESCE( SUM("keyword_hits"."count"), 0 ) 
			FROM keyword_hits WHERE keyword_hits.submission_id = "submissions"."id" 
			AND ${name} >= 1)`
		return sqlout;
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

	const assessmentCountExpr = sql<number>`COALESCE(json_array_length(${submissions.assessments}), 0)`;

	let orderColumn;
	switch (q.sort) {
		case 'date':
			orderColumn = submissions.dateSigned;
			break;
		case 'surname':
			orderColumn = submissions.submitterSurname;
			break;
		case 'screening':
			orderColumn = submissions.screening;
			break;
		case 'assessments':
			orderColumn = assessmentCountExpr;
			break;
		case 'status':
			orderColumn = submissions.status;
			break;
		case 'total':
			orderColumn = totalExpr;
			break;
		default:
			orderColumn = q.sort.startsWith('category')
				? createCategorySQLStatement(q.sort.replace('category', ''))
				: attachmentCountExpr;
	}

	const orderExpr = q.order === 'asc' ? asc(orderColumn) : desc(orderColumn);

	const baseRows = db
		.select({
			uuid: submissions.submissionUuid,
			surname: submissions.submitterSurname,
			childYouthFirstName: submissions.childYouthFirstName,
			childYouthLastName: submissions.childYouthLastName,
			screening: submissions.screening,
			assessments: submissions.assessments,
			submittedAt: submissions.dateSigned,
			status: submissions.status,
			category1: createCategorySQLStatement('1'),
			category2: createCategorySQLStatement('2'),
			category3: createCategorySQLStatement('3'),
			category4: createCategorySQLStatement('4'),
			category5: createCategorySQLStatement('5'),
			category6: createCategorySQLStatement('6'),
			category7: createCategorySQLStatement('7'),
			category8: createCategorySQLStatement('8'),
			category9: createCategorySQLStatement('9'),
			category10: createCategorySQLStatement('10'),
			category11: createCategorySQLStatement('11'),
			category12: createCategorySQLStatement('12'),
			category13: createCategorySQLStatement('13'),
			total: totalExpr,
			attachmentCount: attachmentCountExpr,
		})
		.from(submissions);

	const rowsQuery = effectiveFilter
		? baseRows
				.where(effectiveFilter)
				.orderBy(orderExpr)
				.limit(q.size)
				.offset((q.page - 1) * q.size)
		: baseRows
				.orderBy(orderExpr)
				.limit(q.size)
				.offset((q.page - 1) * q.size);

	const totalQuery = effectiveFilter
		? db.select({ n: count() }).from(submissions).where(effectiveFilter)
		: db.select({ n: count() }).from(submissions);

	const shouldIncludeInvalidTable =
		q.statusFilter === 'all' || q.statusFilter === 'invalid';

	function createSubFieldFromRawJsonSQLStatement(fieldPath: string): SQL<string> {
		const rawFieldPath = sql.raw(`'$.${fieldPath}'`);
		const sqlout = sql<string>`(CASE WHEN json_valid(raw_payload) = 1
			THEN COALESCE(json_extract(raw_payload, ${rawFieldPath}), '—')
			ELSE '—' END)`
		return sqlout;
	}

	function assessmentCountRawJsonSQLStatement(): SQL<number> {
		const rawFieldPath = sql.raw(`'$.editGrid'`);
		const sqlout = sql<number>`(CASE WHEN json_valid(raw_payload) = 1
		THEN COALESCE( NULLIF( json_array_length( 
			COALESCE( json_extract(raw_payload, ${rawFieldPath}) , '[]') 
			), 0), '—')
		ELSE '—' END)`
		return sqlout;
	}

	const invalidSortColumn =
		q.sort === 'surname'
			? createSubFieldFromRawJsonSQLStatement('agreementSignatorysLegalLastName')
			: q.sort === 'screening'
				? createSubFieldFromRawJsonSQLStatement('screening')
				: q.sort === 'assessments'
					? assessmentCountRawJsonSQLStatement()
					: invalidSubmissions.receivedAt;
	const invalidOrderExpr = q.order === 'asc' ? asc(invalidSortColumn) : desc(invalidSortColumn);

	const [rows, totalRow, invalidRows] = await Promise.all([
		rowsQuery,
		totalQuery,
		shouldIncludeInvalidTable
			? db
					.select({
						uuid: invalidSubmissions.submissionUuid,
						receivedAt: invalidSubmissions.receivedAt,
						validationErrors: invalidSubmissions.validationErrors,
						ipAddress: invalidSubmissions.ipAddress,
						childYouthFirstName: createSubFieldFromRawJsonSQLStatement('childYouthsFirstName'),
						childYouthLastName: createSubFieldFromRawJsonSQLStatement('childYouthsLastName'),
						surname: createSubFieldFromRawJsonSQLStatement('agreementSignatorysLegalLastName'),
						screening: createSubFieldFromRawJsonSQLStatement('screening'),
						assessments: assessmentCountRawJsonSQLStatement()
					})
					.from(invalidSubmissions)
					.orderBy(invalidOrderExpr)
			: Promise.resolve([])
	]);
	const regularTotal = totalRow[0]?.n ?? 0;
	const total = regularTotal + invalidRows.length;

	auditLog(
		'submission_listed',
		{
			actorUserId: locals.user!.id,
			actorRole: [...locals.roles][0],
			route: url.pathname,
			requestId: locals.requestId
		},
		locals.logger
	);

	return {
		rows,
		invalidRows,
		total,
		query: q,
		totalPages: Math.max(1, Math.ceil(regularTotal / q.size)),
		searchError: null as string | null,
		categoryMap
	};
};
