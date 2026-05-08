import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('file upload reflects selected filenames', async ({ page }) => {
	await page.goto('/');
	const fixture = path.resolve(here, 'fixtures/sample.pdf');
	await page.setInputFiles('input[type=file]', fixture);
	await expect(page.getByText('sample.pdf')).toBeVisible();
});
