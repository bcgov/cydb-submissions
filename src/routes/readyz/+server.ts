import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { dbPing, attachmentsDirOk } from '$lib/server/health';

export const GET = async () => {
	const checks = {
		db: await dbPing(db),
		attachments: attachmentsDirOk(env.ATTACHMENTS_DIR ?? '/data/attachments')
	};
	const ok = Object.values(checks).every(Boolean);
	return json({ ok, checks }, { status: ok ? 200 : 503 });
};
