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
			attachmentCount: attachmentCountExpr,
			category1: count(keywordHits.category1),
			category2: count(keywordHits.category2),
			category3: count(keywordHits.category3),
			category4: count(keywordHits.category4),
			category5: count(keywordHits.category5),
			category6: count(keywordHits.category6),
			category7: count(keywordHits.category7),
			category8: count(keywordHits.category8),
			category9: count(keywordHits.category9),
			category10: count(keywordHits.category10),
			category11: count(keywordHits.category11),
			category12: count(keywordHits.category12),
			category13: count(keywordHits.category13),
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
