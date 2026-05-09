import { describe, it, expect, vi } from 'vitest';
import { KongMsDiProvider } from '$lib/server/ocr/provider-kong-msdi';
import { KongTokenCache } from '$lib/server/ocr/kong-token';

function fakeTokenCache(): KongTokenCache {
	const tokenFetch = vi.fn(async () => ({
		ok: true,
		json: async () => ({ access_token: 't', expires_in: 3600 })
	}));
	return new KongTokenCache({
		tokenUrl: 't',
		clientId: 'i',
		clientSecret: 's',
		fetch: tokenFetch as unknown as typeof fetch
	});
}

describe('KongMsDiProvider', () => {
	it('submits, polls, and returns content on success', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce({
				status: 202,
				headers: {
					get: (h: string) => (h.toLowerCase() === 'operation-location' ? 'https://op.test/123' : null)
				}
			})
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'running' }) })
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: 'succeeded', analyzeResult: { content: 'hello world', pages: [{}] } })
			});
		const p = new KongMsDiProvider({
			baseUrl: 'https://api.test',
			modelId: 'prebuilt-read',
			apiVersion: '2024-11-30',
			tokenCache: fakeTokenCache(),
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		const r = await p.analyze(Buffer.from('a'), 'application/pdf', 'x.pdf');
		expect(r.rawText).toBe('hello world');
		expect(r.pages).toBe(1);
		expect(r.modelId).toBe('prebuilt-read');
		expect(r.apiVersion).toBe('2024-11-30');
	});

	it('throws OcrProviderError on a non-202 submit', async () => {
		const fakeFetch = vi.fn().mockResolvedValueOnce({ status: 400, headers: { get: () => null } });
		const p = new KongMsDiProvider({
			baseUrl: 'https://api.test',
			modelId: 'prebuilt-read',
			apiVersion: '2024-11-30',
			tokenCache: fakeTokenCache(),
			fetch: fakeFetch as unknown as typeof fetch
		});
		await expect(p.analyze(Buffer.from('a'), 'application/pdf', 'x.pdf')).rejects.toThrow(/OcrSubmitError_400/);
	});

	it('throws OcrProviderError when MS DI returns failed', async () => {
		const fakeFetch = vi
			.fn()
			.mockResolvedValueOnce({
				status: 202,
				headers: {
					get: (h: string) => (h.toLowerCase() === 'operation-location' ? 'https://op.test/123' : null)
				}
			})
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'failed' }) });
		const p = new KongMsDiProvider({
			baseUrl: 'https://api.test',
			modelId: 'prebuilt-read',
			apiVersion: '2024-11-30',
			tokenCache: fakeTokenCache(),
			fetch: fakeFetch as unknown as typeof fetch,
			pollIntervalMs: 1,
			timeoutMs: 5000
		});
		await expect(p.analyze(Buffer.from('a'), 'application/pdf', 'x.pdf')).rejects.toThrow(/OcrAnalyzeFailed/);
	});

	it('throws OcrProviderError on missing operation-location', async () => {
		const fakeFetch = vi.fn().mockResolvedValueOnce({ status: 202, headers: { get: () => null } });
		const p = new KongMsDiProvider({
			baseUrl: 'https://api.test',
			modelId: 'prebuilt-read',
			apiVersion: '2024-11-30',
			tokenCache: fakeTokenCache(),
			fetch: fakeFetch as unknown as typeof fetch
		});
		await expect(p.analyze(Buffer.from('a'), 'application/pdf', 'x.pdf')).rejects.toThrow(/OcrMissingOperationLocation/);
	});
});
