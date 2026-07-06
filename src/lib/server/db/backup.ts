import type { Logger } from 'pino';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { sqlite } from './index.js';
import * as schema from './schema.js';
import { getSystemState, setSystemState } from '../ocr/system-state.js';

const execFile = promisify(execFileCb);

type Db = BetterSQLite3Database<typeof schema>;

const STATE_KEY = 'db.backup.lastScheduledAt';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MAX_BACKUPS = 10;
export const BACKUP_HOUR = 2;

export interface BackupResult {
	path: string;
	sizeBytes: number;
}

export async function createBackup(dbPath: string): Promise<BackupResult> {
	const dbDir = dirname(dbPath);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const rawPath = join(dbDir, `backup-${timestamp}.db`);
	const compressedPath = join(dbDir, `backup-${timestamp}.db.tar.xz`);

	sqlite().prepare('VACUUM INTO ?').run(rawPath);

	try {
		await execFile('tar', ['-cJf', compressedPath, '-C', dbDir, basename(rawPath)]);
	} finally {
		await unlink(rawPath).catch(() => undefined);
	}

	const { size } = await stat(compressedPath);
	return { path: compressedPath, sizeBytes: size };
}

export async function pruneBackups(dbDir: string, maxCount: number): Promise<void> {
	const files = await readdir(dbDir).catch((): string[] => []);
	const sorted = files
		.filter((f) => f.startsWith('backup-') && f.endsWith('.db.tar.xz'))
		.sort()
		.reverse();

	for (const name of sorted.slice(maxCount)) {
		await unlink(join(dbDir, name)).catch(() => undefined);
	}
}

export interface SchedulerHandle {
	stop(): void;
}

export function startBackupScheduler(opts: {
	db: Db;
	dbPath: string;
	maxBackups?: number;
	hour?: number;
	logger: Logger;
}): SchedulerHandle {
	const { db, dbPath, maxBackups = MAX_BACKUPS, hour = BACKUP_HOUR, logger } = opts;
	const STARTUP_DELAY_MS = 5 * 60 * 1000;
	let stopped = false;
	let firstTick = true;
	let timeout: NodeJS.Timeout | null = null;

	function msUntilNext(): number {
		const now = new Date();
		const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
		if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
		return next.getTime() - now.getTime();
	}

	function schedule(): void {
		const ms = firstTick ? Math.max(msUntilNext(), STARTUP_DELAY_MS) : msUntilNext();
		timeout = setTimeout(() => void tick(), ms);
		logger.info({ event: 'db_backup_scheduled', nextRunMs: ms, hour }, 'db backup scheduled');
	}

	async function tick(): Promise<void> {
		if (stopped) return;
		firstTick = false;
		try {
			const result = await createBackup(dbPath);
			setSystemState(db, STATE_KEY, new Date().toISOString());
			logger.info(
				{ event: 'db_backup_created', path: result.path, sizeBytes: result.sizeBytes },
				'nightly db backup created'
			);
			await pruneBackups(dirname(dbPath), maxBackups);
		} catch (e) {
			logger.error(
				{ event: 'db_backup_failed', message: (e as Error).message },
				'nightly db backup failed'
			);
		}
		if (!stopped) schedule();
	}

	function isOverdue(): boolean {
		const last = getSystemState<string>(db, STATE_KEY);
		if (!last) return true;
		return Date.now() - new Date(last).getTime() > MS_PER_DAY;
	}

	schedule();

	if (isOverdue()) {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => void tick(), STARTUP_DELAY_MS);
		logger.info({ event: 'db_backup_immediate' }, 'last backup overdue — running in 5 minutes');
	}

	return {
		stop() {
			stopped = true;
			if (timeout) clearTimeout(timeout);
		}
	};
}
