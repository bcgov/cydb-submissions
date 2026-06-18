import type { PageServerLoad } from './$types';
import { sql, eq, desc, asc, ne, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { keywordHits, submissions } from '$lib/server/db/schema';
import { parseSubmissionsQuery } from '$lib/server/sort';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { getSearchClient } from '$lib/server/search/instance';
import { runSearch, buildStatusFilter } from '$lib/server/search/query';
import { SearchQueryError } from '$lib/server/search/types';
import { getCategoryMapping } from '$lib/server/ocr/keywords';

export const load: PageServerLoad = async ({ url, locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
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
				fuzzyDistance: 2
			});
			return {
				rows: result.rows,
				total: result.total,
				query: q,
				totalPages: Math.max(1, Math.ceil(result.total / q.size)),
				searchError: null as string | null
			};
		} catch (e) {
			if (e instanceof SearchQueryError) {
				return { rows: [], total: 0, query: q, totalPages: 1, searchError: e.message };
			}
			throw e;
		}
	}

	const filterClause =
		q.statusFilter === 'all'
			? undefined
			: q.statusFilter === 'exclude_invalid'
				? ne(submissions.status, 'invalid')
				: eq(submissions.status, q.statusFilter);

	// "submissions"."id" MUST be a quoted literal here, not ${submissions.id}.
	// Drizzle renders the column-ref form as an unqualified "id" inside this subquery,
	// which SQLite mis-resolves to submission_attachments, yielding wrong counts.
	const attachmentCountExpr = sql<number>`(
		SELECT count(*) FROM submission_attachments WHERE submission_id = "submissions"."id"
	)`;

	const categoryCountExpr = sql<number>`(
		SELECT COALESCE( SUM("keyword_hits"."count"), 0 ) 
		FROM keyword_hits WHERE keyword_hits.submission_id = "submissions"."id"`;


	const orderColumn =
		q.sort === 'date'
			? submissions.createdAt
			: q.sort === 'surname'
				? submissions.submitterSurname
				: q.sort === 'status'
					? submissions.status
					: attachmentCountExpr;

	const orderExpr = q.order === 'asc' ? asc(orderColumn) : desc(orderColumn);

	const baseRows = db
		.select({
			uuid: submissions.submissionUuid,
			surname: submissions.submitterSurname,
			childYouthFirstName: submissions.childYouthFirstName,
			childYouthLastName: submissions.childYouthLastName,
			screening: submissions.screening,
			assessments: submissions.assessments,
			submittedAt: submissions.createdAt,
			status: submissions.status,
			category1: categoryCountExpr.append( sql`AND category1 >= 1)`),
			category2: categoryCountExpr.append( sql`AND category2 >= 1)`),
			category3: categoryCountExpr.append( sql`AND category3 >= 1)`),
			category4: categoryCountExpr.append( sql`AND category4 >= 1)`),
			category5: categoryCountExpr.append( sql`AND category5 >= 1)`),
			category6: categoryCountExpr.append( sql`AND category6 >= 1)`),
			category7: categoryCountExpr.append( sql`AND category7 >= 1)`),
			category8: categoryCountExpr.append( sql`AND category8 >= 1)`),
			category9: categoryCountExpr.append( sql`AND category9 >= 1)`),
			category10: categoryCountExpr.append( sql`AND category10 >= 1)`),
			category11: categoryCountExpr.append( sql`AND category11 >= 1)`),
			category12: categoryCountExpr.append( sql`AND category12 >= 1)`),
			category13: categoryCountExpr.append( sql`AND category13 >= 1)`),
			attachmentCount: attachmentCountExpr,
		})
		.from(submissions)
		.leftJoin(keywordHits, eq(submissions.id, keywordHits.submissionId))
		.groupBy(submissions.id);

	const rowsQuery = filterClause
		? baseRows
				.where(filterClause)
				.orderBy(orderExpr)
				.limit(q.size)
				.offset((q.page - 1) * q.size)
		: baseRows
				.orderBy(orderExpr)
				.limit(q.size)
				.offset((q.page - 1) * q.size);

	const totalQuery = filterClause
		? db.select({ n: count() }).from(submissions).where(filterClause)
		: db.select({ n: count() }).from(submissions);

	const [rows, totalRow] = await Promise.all([rowsQuery, totalQuery]);
	const total = totalRow[0]?.n ?? 0;

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

	const categoryMap = await getCategoryMapping();

	return {
		rows,
		total,
		query: q,
		totalPages: Math.max(1, Math.ceil(total / q.size)),
		searchError: null as string | null,
		categoryMap
	};
};
