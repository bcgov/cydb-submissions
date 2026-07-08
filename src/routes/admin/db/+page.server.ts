import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createBackup, getBackupDir } from '$lib/server/db/backup';

function isValidBackupName(name: string): boolean {
	return /^backup-(scheduled|manual)-[\dT\-Z]+\.db\.tar\.gzip$/.test(name);
}

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');

	const dbPath = env.DATABASE_URL;
	if (!dbPath) return { scheduled: [], manual: [] };

	const backupDir = getBackupDir(dbPath);

	try {
		const files = await readdir(backupDir);

		const toEntry = async (name: string) => {
			const info = await stat(join(backupDir, name));
			return { name, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
		};

		const [scheduled, manual] = await Promise.all([
			Promise.all(
				files
					.filter((f) => f.startsWith('backup-scheduled-') && f.endsWith('.db.tar.gzip'))
					.sort()
					.reverse()
					.map(toEntry)
			),
			Promise.all(
				files
					.filter((f) => f.startsWith('backup-manual-') && f.endsWith('.db.tar.gzip'))
					.sort()
					.reverse()
					.map(toEntry)
			)
		]);

		return { scheduled, manual };
	} catch {
		return { scheduled: [], manual: [] };
	}
};

function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
	return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

export const actions: Actions = {
	backup: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'backup', error: 'CSRF token mismatch' });
		}

		const dbPath = env.DATABASE_URL;
		if (!dbPath) return fail(500, { action: 'backup', error: 'DATABASE_URL is not set' });

		const result = await createBackup(dbPath, 'manual');

		auditLog(
			'db_backup_created',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: `manual backup written to ${result.path} (${result.sizeBytes} bytes)`
			},
			locals.logger
		);

		return {
			action: 'backup',
			success: `Backup written to ${result.path} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`
		};
	},

	deleteBackup: async ({ request, locals, url, cookies }) => {
		requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
		const form = await request.formData();
		if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
			return fail(403, { action: 'deleteBackup', error: 'CSRF token mismatch' });
		}

		const name = form.get('name');
		if (typeof name !== 'string' || !isValidBackupName(name) || !name.startsWith('backup-manual-')) {
			return fail(400, { action: 'deleteBackup', error: 'Invalid backup name' });
		}

		const dbPath = env.DATABASE_URL;
		if (!dbPath) return fail(500, { action: 'deleteBackup', error: 'DATABASE_URL is not set' });

		// basename guards against path traversal
		const filePath = join(getBackupDir(dbPath), basename(name));
		await unlink(filePath);

		auditLog(
			'db_backup_deleted',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: `manual backup deleted: ${name}`
			},
			locals.logger
		);

		return { action: 'deleteBackup', success: `Deleted ${name}` };
	},
};
