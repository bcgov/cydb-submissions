import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { dbPing, attachmentsDirOk, authConfigured } from '$lib/server/health';
import { getSystemState } from '$lib/server/ocr/system-state';

export const GET = async () => {
	const checks = {
		db: await dbPing(db),
		attachments: attachmentsDirOk(env.ATTACHMENTS_DIR ?? '/data/attachments'),
		auth: authConfigured(env.BETTER_AUTH_SECRET)
	};
	let queue: 'ok' | 'halted' | 'disabled' = env.OCR_WORKER_ENABLED === '1' ? 'ok' : 'disabled';
	if (queue === 'ok' && getSystemState(db, 'ocr.halted')) queue = 'halted';
	// Per G2 default: queue halt does NOT flip the readiness HTTP status.
	// The public form is independent of the back-office OCR queue.
	const ok = Object.values(checks).every(Boolean);
	return json({ ok, checks, queue }, { status: ok ? 200 : 503 });
};
