import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

test('rejected submission is recorded in invalid_submissions', async ({ page, request }) => {
	// Visit the page to obtain a CSRF cookie.
	await page.goto('/');
	const cookies = await page.context().cookies();
	const csrf = cookies.find((c) => c.name === 'cydb_csrf')!.value;
	const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

	const sqlite = new Database(path.join(repoRoot, 'local.db'));
	const before = (sqlite.prepare('SELECT count(*) AS c FROM invalid_submissions').get() as { c: number }).c;
	sqlite.close();

	const r = await request.post('/', {
		multipart: {
			payload: JSON.stringify({ childInfo: {} }),
			csrfTokenEcho: csrf,
			browserFingerprint: 'test'
		},
		headers: { cookie: cookieHeader }
	});
	// SvelteKit form actions wrap fail() in a 200 response with type=failure
	// and the original status code embedded in the body.
	expect(r.status()).toBe(200);
	const body = await r.json();
	expect(body.type).toBe('failure');
	expect(body.status).toBe(400);

	const sqlite2 = new Database(path.join(repoRoot, 'local.db'));
	const after = (sqlite2.prepare('SELECT count(*) AS c FROM invalid_submissions').get() as { c: number }).c;
	sqlite2.close();
	expect(after).toBeGreaterThan(before);
});
