import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sqlite } from '$lib/server/db';
import { requireRole } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

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

		const dbDir = dirname(dbPath);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const rawPath = join(dbDir, `backup-${timestamp}.db`);
		const compressedPath = join(dbDir, `backup-${timestamp}.db.tar.xz`);

		// VACUUM INTO produces a consistent, wal-checkpointed copy
		sqlite().prepare('VACUUM INTO ?').run(rawPath);

		try {
			// -cJf: create, xz compression (LZMA2, highest ratio), to file
			// -C: change to dbDir so the archive contains only the bare filename
			await execFile('tar', ['-cJf', compressedPath, '-C', dbDir, basename(rawPath)]);
		} finally {
			await unlink(rawPath).catch(() => undefined);
		}

		const { size } = await stat(compressedPath);

		auditLog(
			'db_backup_created',
			{
				actorUserId: locals.user!.id,
				actorRole: 'admin',
				route: url.pathname,
				requestId: locals.requestId,
				reason: `backup written to ${compressedPath} (${size} bytes)`
			},
			locals.logger
		);

		return {
			action: 'backup',
			success: `Backup written to ${compressedPath} (${(size / 1024 / 1024).toFixed(2)} MB)`
		};
	}
};
