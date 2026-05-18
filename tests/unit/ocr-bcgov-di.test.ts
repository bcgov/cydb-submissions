import { describe, it, expect, vi } from 'vitest';
import { BcgovDiProvider } from '$lib/server/ocr/provider-bcgov-di';

function okResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
	return {
		ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
		status: init.status ?? 200,
		headers: { get: (h: string) => init.headers?.[h.toLowerCase()] ?? null },
		json: async () => body,
		text: async () => JSON.stringify(body)
	};
}

describe('BcgovDiProvider', () => {
	it('submits, polls, fetches result, and returns OcrAnalysis on success', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce(okResponse({ document: { id: 'doc-1', status: 'ongoing_ocr' } })) // POST /api/upload
			.mockResolvedValueOnce(okResponse({ status: 'ongoing_ocr' })) // GET /api/documents/doc-1 (1st poll)
			.mockResolvedValueOnce(okResponse({ status: 'done' })) // GET /api/documents/doc-1 (2nd poll)
			.mockResolvedValueOnce(
				okResponse({
					ocr_result: {
						content: {
							format: 'text',
							text: 'hello world',
							pages: [{ pageNumber: 1, content: 'hello world', lines: [] }]
						}
					}
				})
			);
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		const r = await p.analyze(Buffer.from('PDF-BYTES'), 'application/pdf', 'doc.pdf');
		expect(r.rawText).toBe('hello world');
		expect(r.pages).toBe(1);
		expect(r.modelId).toBe('prebuilt-read');
		expect(r.apiVersion).toBe('bcgov-di-ocr-only-minimal');

		// Inspect the upload call
		const submitCall = fakeFetch.mock.calls[0];
		expect(submitCall[0]).toBe('https://di.test/api/upload');
		expect(submitCall[1].method).toBe('POST');
		expect(submitCall[1].headers['x-api-key']).toBe('k');
		expect(submitCall[1].headers['content-type']).toBe('application/json');
		const body = JSON.parse(submitCall[1].body as string);
		expect(body.file).toBe(Buffer.from('PDF-BYTES').toString('base64'));
		expect(body.file_type).toBe('pdf');
		expect(body.original_filename).toBe('doc.pdf');
		expect(body.workflow_slug).toBe('ocr-only-minimal');
	});

	it.each([
		['application/pdf', 'a.pdf', 'pdf'],
		['image/jpeg', 'b.jpeg', 'jpg'],
		['image/png', 'c.png', 'png'],
		['image/heic', 'd.heic', 'heic']
	])('maps mime %s + filename %s to file_type %s', async (mime, name, expected) => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce(okResponse({ document: { id: 'doc-1', status: 'done' } }))
			.mockResolvedValueOnce(okResponse({ status: 'done' }))
			.mockResolvedValueOnce(
				okResponse({ ocr_result: { content: { format: 'text', text: '', pages: [] } } })
			);
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await p.analyze(Buffer.from('x'), mime, name);
		const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
		expect(body.file_type).toBe(expected);
	});

	it('falls back to filename extension when mime is unknown', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce(okResponse({ document: { id: 'doc-1', status: 'done' } }))
			.mockResolvedValueOnce(okResponse({ status: 'done' }))
			.mockResolvedValueOnce(
				okResponse({ ocr_result: { content: { format: 'text', text: '', pages: [] } } })
			);
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await p.analyze(Buffer.from('x'), 'application/octet-stream', 'mystery.TIFF');
		const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string);
		expect(body.file_type).toBe('tiff');
	});

	it('throws OcrProviderError on non-2xx upload', async () => {
		const fakeFetch = vi.fn().mockResolvedValueOnce(okResponse({ error: 'bad' }, { status: 400 }));
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await expect(p.analyze(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow(
			/OcrSubmitError_400/
		);
	});

	it('throws OcrProviderError when upload response is missing document.id', async () => {
		const fakeFetch = vi.fn().mockResolvedValueOnce(okResponse({ document: { status: 'ongoing_ocr' } }));
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await expect(p.analyze(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow(
			/OcrMissingDocumentId/
		);
	});

	it('throws OcrProviderError when document status is failed', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce(okResponse({ document: { id: 'doc-1', status: 'ongoing_ocr' } }))
			.mockResolvedValueOnce(okResponse({ status: 'failed' }));
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await expect(p.analyze(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow(
			/OcrAnalyzeFailed/
		);
	});

	it('throws OcrProviderError when result fetch fails', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce(okResponse({ document: { id: 'doc-1', status: 'done' } }))
			.mockResolvedValueOnce(okResponse({ status: 'done' }))
			.mockResolvedValueOnce(okResponse({ error: 'boom' }, { status: 500 }));
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await expect(p.analyze(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow(
			/OcrResultFetchError_500/
		);
	});

	it('throws OcrTimeoutError when status never settles before deadline', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce(okResponse({ document: { id: 'doc-1', status: 'ongoing_ocr' } }))
			.mockResolvedValue(okResponse({ status: 'ongoing_ocr' }));
		const p = new BcgovDiProvider({
			baseUrl: 'https://di.test',
			apiKey: 'k',
			workflowSlug: 'ocr-only-minimal',
			modelId: 'prebuilt-read',
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 10
		});
		await expect(p.analyze(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow(
			/OcrTimeoutError/
		);
	});
});
