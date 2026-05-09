import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KongTokenCache } from '$lib/server/ocr/kong-token';

const fakeFetch = vi.fn();

beforeEach(() => fakeFetch.mockReset());

function asFetch(): typeof fetch {
	return fakeFetch as unknown as typeof fetch;
}

describe('KongTokenCache', () => {
	it('fetches a token on first call and caches it', async () => {
		fakeFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ access_token: 'abc', expires_in: 3600 })
		});
		const cache = new KongTokenCache({
			tokenUrl: 'https://t.test/token',
			clientId: 'i',
			clientSecret: 's',
			fetch: asFetch()
		});
		expect(await cache.token()).toBe('abc');
		expect(await cache.token()).toBe('abc');
		expect(fakeFetch).toHaveBeenCalledTimes(1);
	});

	it('refreshes once the cached token nears expiry', async () => {
		fakeFetch
			.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'a1', expires_in: 1 }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'a2', expires_in: 3600 }) });
		const cache = new KongTokenCache({
			tokenUrl: 'https://t.test/token',
			clientId: 'i',
			clientSecret: 's',
			fetch: asFetch(),
			skewSeconds: 0
		});
		expect(await cache.token()).toBe('a1');
		await new Promise((r) => setTimeout(r, 1100));
		expect(await cache.token()).toBe('a2');
	});

	it('throws on a non-OK response', async () => {
		fakeFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad creds' });
		const cache = new KongTokenCache({
			tokenUrl: 'https://t.test/token',
			clientId: 'i',
			clientSecret: 's',
			fetch: asFetch()
		});
		await expect(cache.token()).rejects.toThrow(/Kong token endpoint/);
	});

	it('coalesces concurrent calls into a single fetch', async () => {
		fakeFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ access_token: 'shared', expires_in: 3600 })
		});
		const cache = new KongTokenCache({
			tokenUrl: 'https://t.test/token',
			clientId: 'i',
			clientSecret: 's',
			fetch: asFetch()
		});
		const [a, b, c] = await Promise.all([cache.token(), cache.token(), cache.token()]);
		expect([a, b, c]).toEqual(['shared', 'shared', 'shared']);
		expect(fakeFetch).toHaveBeenCalledTimes(1);
	});
});
