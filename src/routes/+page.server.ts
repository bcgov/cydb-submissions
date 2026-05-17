import type { Actions, RequestEvent } from './$types';
import { fail } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { submissionSchema } from '$lib/form/schema';
import { extractMetadata } from '$lib/server/metadata';
import { saveAttachments } from '$lib/server/storage';
import { writeValidSubmission, writeInvalidSubmission } from '$lib/server/submissions';

const CSRF_COOKIE = 'cydb_csrf';
const ALLOWED_MIME = new Set((env.ALLOWED_UPLOAD_MIME ?? '').split(',').filter(Boolean));
const MAX_BYTES = Number(env.MAX_UPLOAD_BYTES ?? 26214400);
const ATTACHMENTS_DIR = env.ATTACHMENTS_DIR ?? './attachments';

function safeIp(evt: RequestEvent): string | null {
	try { return evt.getClientAddress(); } catch { return null; }
}

export const actions: Actions = {
	default: async (event) => {
		if (env.CHEFS_INGEST_ONLY === '1') {
			event.locals.logger.warn(
				{ event: 'public_submission_blocked' },
				'public form submission blocked: CHEFS_INGEST_ONLY=1'
			);
			return fail(410, { error: 'Direct form submission is disabled — submit via CHEFS.' });
		}
		const log = event.locals.logger;
		const form = await event.request.formData();
		const submissionUuid = 'sub_' + nanoid(12);
		log.info({ event: 'submission_received', submissionUuid }, 'submission received');

		// Honeypot
		const honeypot = form.get('website');
		if (typeof honeypot === 'string' && honeypot.length > 0) {
			log.warn({ event: 'honeypot_tripped', submissionUuid }, 'honeypot tripped');
			return fail(400, { error: 'Submission rejected.' });
		}

		// CSRF echo must match cookie
		const cookieToken = event.cookies.get(CSRF_COOKIE);
		const echoToken = String(form.get('csrfTokenEcho') ?? '');
		if (!cookieToken || cookieToken !== echoToken) {
			log.warn({ event: 'csrf_mismatch', submissionUuid }, 'csrf token mismatch');
			return fail(400, { error: 'Session expired. Reload and try again.' });
		}

		const rawPayload = String(form.get('payload') ?? '');
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawPayload);
		} catch {
			log.warn({ event: 'payload_unparseable', submissionUuid }, 'payload not JSON');
			await writeInvalidSubmission(db, {
				submissionUuid,
				rawPayload,
				validationErrors: [{ message: 'unparseable JSON' }],
				ipAddress: safeIp(event),
				userAgent: event.request.headers.get('user-agent')
			});
			return fail(400, { error: 'Invalid submission.' });
		}

		const result = submissionSchema.safeParse(parsed);
		if (!result.success) {
			log.warn(
				{ event: 'validation_failed', submissionUuid, issues: result.error.issues.length },
				'validation failed'
			);
			await writeInvalidSubmission(db, {
				submissionUuid,
				rawPayload,
				validationErrors: result.error.issues,
				ipAddress: safeIp(event),
				userAgent: event.request.headers.get('user-agent')
			});
			return fail(400, { error: 'Some fields are invalid. Please review and resubmit.' });
		}

		const files: File[] = [];
		for (const v of form.getAll('attachments')) {
			if (v instanceof File && v.size > 0) files.push(v);
		}

		let saved: Awaited<ReturnType<typeof saveAttachments>> = [];
		try {
			saved = await saveAttachments(
				{ baseDir: ATTACHMENTS_DIR, submissionUuid, maxBytes: MAX_BYTES, allowedMime: ALLOWED_MIME },
				files
			);
			log.info(
				{ event: 'attachments_saved', submissionUuid, count: saved.length },
				'attachments stored'
			);
		} catch (e) {
			log.error(
				{ event: 'attachment_failure', submissionUuid, error: (e as Error).message },
				'attachment write failed'
			);
			return fail(400, { error: 'Attachment rejected: ' + (e as Error).message });
		}

		const meta = extractMetadata(event, {
			browserFingerprint: String(form.get('browserFingerprint') ?? '') || undefined,
			csrfTokenEcho: echoToken,
			sessionId: undefined
		});

		try {
			const { submissionId } = await writeValidSubmission(db, {
				submissionUuid,
				payload: result.data,
				metadata: meta,
				attachments: saved
			});
			log.info(
				{ event: 'submission_persisted', submissionUuid, submissionId, attachmentCount: saved.length },
				'submission committed'
			);
			return { success: true, submissionUuid };
		} catch (e) {
			log.error(
				{ event: 'persist_failure', submissionUuid, error: (e as Error).message },
				'db write failed'
			);
			return fail(500, { error: 'Could not save submission. Please try again later.' });
		}
	}
};
