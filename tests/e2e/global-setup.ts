import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default async function globalSetup() {
	const dbPath = path.join(repoRoot, 'local.db');
	rmSync(dbPath, { force: true });
	rmSync(`${dbPath}-wal`, { force: true });
	rmSync(`${dbPath}-shm`, { force: true });
	rmSync(path.join(repoRoot, 'attachments'), { recursive: true, force: true });
	execSync('node scripts/migrate.mjs', {
		cwd: repoRoot,
		env: { ...process.env, DATABASE_URL: 'local.db' },
		stdio: 'pipe'
	});
}
