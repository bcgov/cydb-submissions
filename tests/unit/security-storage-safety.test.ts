import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveAttachments } from '$lib/server/storage';

function file(name: string, type: string, bytes: Uint8Array): File {
	return new File([bytes], name, { type });
}

const PDF_MAGIC = new TextEncoder().encode('%PDF-1.4\n%hi\n');
const HTML_BYTES = new TextEncoder().encode('<html><script>alert(1)</script></html>');

describe('saveAttachments — defensive file-write hardening (6.10, 9.3, 9.4)', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'cydb-storage-'));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('strips path components from f.name so writes stay inside the submission directory', async () => {
		// Realistic attack: legit-looking filename with embedded traversal.
		// (A filename like "../../etc/passwd" with no extension is rejected
		// outright by the extension check covered below.)
		const f = file('../../../evil.pdf', 'application/pdf', PDF_MAGIC);
		await saveAttachments(
			{ baseDir: dir, submissionUuid: 'sub_a', maxBytes: 1024, allowedMime: new Set(['application/pdf']) },
			[f]
		);
		const subDir = path.join(dir, 'sub_a');
		const entries = readdirSync(subDir);
		// File persisted inside the submission directory; basename stripped.
		expect(entries).toEqual(['evil.pdf']);
		for (const e of entries) {
			expect(e).not.toContain('..');
			expect(e).not.toContain('/');
		}
		// Nothing escaped to the parent of the basedir.
		expect(existsSync(path.join(dir, '..', 'evil.pdf'))).toBe(false);
	});

	it('rejects a file whose magic bytes do not match the claimed PDF mime', async () => {
		const f = file('evil.pdf', 'application/pdf', HTML_BYTES);
		await expect(
			saveAttachments(
				{ baseDir: dir, submissionUuid: 'sub_b', maxBytes: 1024, allowedMime: new Set(['application/pdf']) },
				[f]
			)
		).rejects.toThrow(/mime|magic|signature|content/i);
	});

	it('rejects a double-extension filename like evil.pdf.exe regardless of mime header', async () => {
		const f = file('evil.pdf.exe', 'application/pdf', PDF_MAGIC);
		await expect(
			saveAttachments(
				{ baseDir: dir, submissionUuid: 'sub_c', maxBytes: 1024, allowedMime: new Set(['application/pdf']) },
				[f]
			)
		).rejects.toThrow(/extension|filename|reject/i);
	});

	it('preserves the size + mime rejection paths after hardening', async () => {
		const big = file('big.pdf', 'application/pdf', new Uint8Array(2048));
		await expect(
			saveAttachments(
				{ baseDir: dir, submissionUuid: 'sub_d', maxBytes: 1024, allowedMime: new Set(['application/pdf']) },
				[big]
			)
		).rejects.toThrow(/too large|size/i);

		const wrongMime = file('foo.txt', 'text/plain', new TextEncoder().encode('hi'));
		await expect(
			saveAttachments(
				{ baseDir: dir, submissionUuid: 'sub_e', maxBytes: 1024, allowedMime: new Set(['application/pdf']) },
				[wrongMime]
			)
		).rejects.toThrow(/not allowed|mime/i);
	});
});
