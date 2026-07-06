import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createBackup, pruneBackups, MAX_BACKUPS } from '$lib/server/db/backup';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');

	const dbPath = env.DATABASE_URL;
	if (!dbPath) return { backups: [] };

	const dbDir = dirname(dbPath);

	try {
		const files = await readdir(dbDir);
		const backupFiles = files.filter((f) => f.startsWith('backup-') && f.endsWith('.db.tar.xz'));

		const backups = await Promise.all(
			backupFiles.map(async (name) => {
				const info = await stat(join(dbDir, name));
				return { name, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
			})
		);

		backups.sort((a, b) => b.name.localeCompare(a.name));
		return { backups };
	} catch {
		return { backups: [] };
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

		const result = await createBackup(dbPath);
		await pruneBackups(dirname(dbPath), MAX_BACKUPS);

		auditLog(
			'db_backup_created',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: `backup written to ${result.path} (${result.sizeBytes} bytes)`
			},
			locals.logger
		);

		return {
			action: 'backup',
			success: `Backup written to ${result.path} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`
		};
	}
};
