import { describe, it, expect, vi } from 'vitest';
import { ChesMailer } from '$lib/server/mail/mailer-ches';
import { ChesTokenCache } from '$lib/server/mail/ches-token';

function fakeTokenCache(value = 'tok-abc'): ChesTokenCache {
	const tokenFetch = vi.fn(async () => ({
		ok: true,
		json: async () => ({ access_token: value, expires_in: 3600 })
	}));
	return new ChesTokenCache({
		tokenUrl: 'https://kc/token',
		clientId: 'cid',
		clientSecret: 'sek',
		fetch: tokenFetch as unknown as typeof fetch
	});
}

function okResponse(body: unknown, status = 201) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(body),
		json: async () => body
	};
}

describe('ChesMailer', () => {
	it('POSTs to ${baseUrl}/email with Bearer token and the CHES payload shape', async () => {
		const fakeFetch = vi.fn(async () =>
			okResponse({ messages: [{ msgId: 'm-1', to: ['ops@gov.bc.ca'] }] })
		);
		const m = new ChesMailer({
			baseUrl: 'https://ches.test/api/v1',
			tokenCache: fakeTokenCache(),
			fetch: fakeFetch as unknown as typeof fetch
		});
		await m.send({
			from: 'cydb-noreply@gov.bc.ca',
			to: ['ops@gov.bc.ca'],
			subject: 'OCR queue halted',
			body: 'plain-text body'
		});
		expect(fakeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://ches.test/api/v1/email');
		expect(init.method).toBe('POST');
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toBe('Bearer tok-abc');
		expect(headers['content-type']).toBe('application/json');
		const payload = JSON.parse(init.body as string);
		expect(payload).toEqual({
			from: 'cydb-noreply@gov.bc.ca',
			to: ['ops@gov.bc.ca'],
			subject: 'OCR queue halted',
			bodyType: 'text',
			body: 'plain-text body'
		});
	});

	it('throws when CHES responds with a non-2xx status', async () => {
		const fakeFetch = vi.fn(async () =>
			okResponse({ type: 'about:blank', title: 'Bad Request', detail: 'invalid recipient' }, 400)
		);
		const m = new ChesMailer({
			baseUrl: 'https://ches.test/api/v1',
			tokenCache: fakeTokenCache(),
			fetch: fakeFetch as unknown as typeof fetch
		});
		await expect(
			m.send({
				from: 'cydb-noreply@gov.bc.ca',
				to: ['x@x'],
				subject: 's',
				body: 'b'
			})
		).rejects.toThrow(/CHES request failed.*400/);
	});

	it('refreshes the token before sending (token cache is consulted)', async () => {
		// Wrap a real cache so we can spy on its token() method.
		const cache = fakeTokenCache('fresh-token');
		const spy = vi.spyOn(cache, 'token');
		const fakeFetch = vi.fn(async () => okResponse({ messages: [] }));
		const m = new ChesMailer({
			baseUrl: 'https://ches.test/api/v1',
			tokenCache: cache,
			fetch: fakeFetch as unknown as typeof fetch
		});
		await m.send({
			from: 'a@gov.bc.ca',
			to: ['b@gov.bc.ca'],
			subject: 's',
			body: 'b'
		});
		expect(spy).toHaveBeenCalled();
	});
});
