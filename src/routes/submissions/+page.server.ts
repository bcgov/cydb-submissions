import type { PageServerLoad } from './$types';
import { sql, and, eq, desc, asc, ne, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { submissions } from '$lib/server/db/schema';
import { parseSubmissionsQuery } from '$lib/server/sort';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';

export const load: PageServerLoad = async ({ url, locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
	const q = parseSubmissionsQuery(url);

	const filterClause =
		q.statusFilter === 'all'
			? undefined
			: q.statusFilter === 'exclude_invalid'
				? ne(submissions.status, 'invalid')
				: eq(submissions.status, q.statusFilter);

	const attachmentCountExpr = sql<number>`(
		SELECT count(*) FROM submission_attachments WHERE submission_id = ${submissions.id}
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
			submittedAt: submissions.createdAt,
			status: submissions.status,
			attachmentCount: attachmentCountExpr
		})
		.from(submissions);

	const rowsQuery = filterClause
		? baseRows.where(filterClause).orderBy(orderExpr).limit(q.size).offset((q.page - 1) * q.size)
		: baseRows.orderBy(orderExpr).limit(q.size).offset((q.page - 1) * q.size);

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

	return {
		rows,
		total,
		query: q,
		totalPages: Math.max(1, Math.ceil(total / q.size))
	};
};
