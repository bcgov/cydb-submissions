import { test, expect } from '@playwright/test';

test('/healthz returns 200 and "ok"', async ({ request }) => {
	const r = await request.get('/healthz');
	expect(r.status()).toBe(200);
	expect((await r.text()).trim()).toBe('ok');
});

test('/readyz returns 200 with checks payload', async ({ request }) => {
	const r = await request.get('/readyz');
	expect(r.status()).toBe(200);
	const body = await r.json();
	expect(body.ok).toBe(true);
	expect(body.checks.db).toBe(true);
	expect(body.checks.attachments).toBe(true);
});
