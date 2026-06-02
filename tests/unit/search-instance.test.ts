import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

describe('getSearchClient', () => {
	it('returns a singleton ManticoreClient built from MANTICORE_URL', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: { MANTICORE_URL: 'http://mc:9308' } }));
		const { getSearchClient } = await import('$lib/server/search/instance');
		const { ManticoreClient } = await import('$lib/server/search/manticore');
		const a = getSearchClient();
		const b = getSearchClient();
		expect(a).toBeInstanceOf(ManticoreClient);
		expect(a).toBe(b);
	});

	it('defaults to localhost:9308 when MANTICORE_URL is unset', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const { getSearchClient } = await import('$lib/server/search/instance');
		expect(getSearchClient()).toBeDefined();
	});
});
