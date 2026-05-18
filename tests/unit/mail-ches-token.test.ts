import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChesTokenCache } from '$lib/server/mail/ches-token';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ChesTokenCache', () => {
	it('fetches a token, caches it, and reuses until the skew threshold', async () => {
		const fakeFetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ access_token: 'tok-1', expires_in: 3600 })
		}));
		const c = new ChesTokenCache({
			tokenUrl: 'https://kc/token',
			clientId: 'cid',
			clientSecret: 'sek',
			fetch: fakeFetch as unknown as typeof fetch
		});
		expect(await c.token()).toBe('tok-1');
		expect(await c.token()).toBe('tok-1');
		expect(fakeFetch).toHaveBeenCalledTimes(1);

		// Advance close to the skew threshold but not past it.
		vi.setSystemTime(Date.now() + (3600 - 60) * 1000);
		expect(await c.token()).toBe('tok-1');
		expect(fakeFetch).toHaveBeenCalledTimes(1);

		// Now blow past the skew threshold — should refetch.
		vi.setSystemTime(Date.now() + 60_000);
		fakeFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ access_token: 'tok-2', expires_in: 3600 })
		});
		expect(await c.token()).toBe('tok-2');
		expect(fakeFetch).toHaveBeenCalledTimes(2);
	});

	it('sends client_credentials grant with form-encoded body', async () => {
		const fakeFetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ access_token: 'tok', expires_in: 600 })
		}));
		const c = new ChesTokenCache({
			tokenUrl: 'https://kc/token',
			clientId: 'cid',
			clientSecret: 'sek',
			fetch: fakeFetch as unknown as typeof fetch
		});
		await c.token();
		const [url, init] = fakeFetch.mock.calls[0] as unknown as [
			string,
			RequestInit & { body: URLSearchParams }
		];
		expect(url).toBe('https://kc/token');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>)['content-type']).toBe(
			'application/x-www-form-urlencoded'
		);
		const params = init.body as URLSearchParams;
		expect(params.get('grant_type')).toBe('client_credentials');
		expect(params.get('client_id')).toBe('cid');
		expect(params.get('client_secret')).toBe('sek');
	});

	it('dedupes concurrent calls into a single in-flight request', async () => {
		let resolve: (v: unknown) => void = () => undefined;
		const inflight = new Promise((r) => (resolve = r));
		const fakeFetch = vi.fn(async () => {
			await inflight;
			return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
		});
		const c = new ChesTokenCache({
			tokenUrl: 'https://kc/token',
			clientId: 'cid',
			clientSecret: 'sek',
			fetch: fakeFetch as unknown as typeof fetch
		});
		const [a, b, d] = [c.token(), c.token(), c.token()];
		resolve({});
		expect(await Promise.all([a, b, d])).toEqual(['tok', 'tok', 'tok']);
		expect(fakeFetch).toHaveBeenCalledTimes(1);
	});

	it('throws a descriptive error when the token endpoint fails', async () => {
		const fakeFetch = vi.fn(async () => ({
			ok: false,
			status: 401,
			text: async () => 'invalid_client'
		}));
		const c = new ChesTokenCache({
			tokenUrl: 'https://kc/token',
			clientId: 'cid',
			clientSecret: 'bad',
			fetch: fakeFetch as unknown as typeof fetch
		});
		await expect(c.token()).rejects.toThrow(/CHES token endpoint failed: 401/);
	});
});
