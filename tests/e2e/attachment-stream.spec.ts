import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSubmissions, seedAttachments } from './fixtures/db-helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

test.describe.serial('attachment streaming', () => {
	let attachmentId: number;

	test.beforeAll(async () => {
		const dir = path.join(repoRoot, 'attachments', 'sub-att');
		mkdirSync(dir, { recursive: true });
		const stored = path.join(dir, 'test.pdf');
		writeFileSync(stored, Buffer.from('%PDF-1.4 fake'));
		seedSubmissions([
			{ uuid: 'sub-att', surname: 'Smith', status: 'submitted', createdAt: '2026-04-01T00:00:00Z' }
		]);
		seedAttachments([
			{
				submissionUuid: 'sub-att',
				storedPath: stored,
				originalFilename: 'test.pdf',
				mimeType: 'application/pdf',
				sizeBytes: 13
			}
		]);

		const Database = (await import('better-sqlite3')).default;
		const db = new Database(path.join(repoRoot, 'local.db'));
		const row = db
			.prepare('SELECT id FROM submission_attachments ORDER BY id DESC LIMIT 1')
			.get() as { id: number };
		attachmentId = row.id;
		db.close();
	});

	test('PDF attachment streams inline', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		const cookies = await context.cookies();
		const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
		const resp = await page.request.get(`/attachments/${attachmentId}`, {
			headers: { cookie: cookieHeader }
		});
		expect(resp.status()).toBe(200);
		expect(resp.headers()['content-type']).toBe('application/pdf');
		expect(resp.headers()['content-disposition']).toMatch(/^inline/);
	});

	test('?download=1 sets attachment disposition', async ({ page, context }) => {
		await context.clearCookies();
		await page.goto('/?bypass=worker@test');
		const cookies = await context.cookies();
		const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
		const resp = await page.request.get(`/attachments/${attachmentId}?download=1`, {
			headers: { cookie: cookieHeader }
		});
		expect(resp.headers()['content-disposition']).toMatch(/^attachment/);
	});
});
