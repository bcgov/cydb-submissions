import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { db } from '$lib/server/db';
import { submissionAttachments } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin', 'cfd_worker');
	const id = Number.parseInt(params.id, 10);
	if (!Number.isFinite(id)) throw error(400, 'bad id');

	const rows = await db
		.select()
		.from(submissionAttachments)
		.where(eq(submissionAttachments.id, id))
		.limit(1);
	const att = rows[0];
	if (!att) throw error(404, 'not found');

	const abs = path.resolve(att.storedPath);
	let size: number;
	try {
		size = statSync(abs).size;
	} catch {
		throw error(410, 'attachment file is missing');
	}

	const wantsDownload = url.searchParams.get('download') === '1';
	const disposition = wantsDownload ? 'attachment' : 'inline';

	auditLog(
		'attachment_downloaded',
		{
			attachmentId: att.id,
			actorUserId: locals.user!.id,
			actorRole: [...locals.roles][0],
			route: url.pathname,
			requestId: locals.requestId,
			reason: wantsDownload ? 'download' : 'preview'
		},
		locals.logger
	);

	const stream = createReadStream(abs);
	return new Response(stream as never, {
		status: 200,
		headers: {
			'Content-Type': att.mimeType,
			'Content-Length': String(size),
			'Content-Disposition': `${disposition}; filename="${encodeURIComponent(att.originalFilename)}"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
