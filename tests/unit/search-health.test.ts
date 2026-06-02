import { describe, it, expect } from 'vitest';
import { pingSearch } from '$lib/server/search/health';
import type { SearchClient } from '$lib/server/search/types';

const up: Pick<SearchClient, 'ping'> = { ping: async () => true };
const down: Pick<SearchClient, 'ping'> = { ping: async () => false };

describe('pingSearch', () => {
	it('reflects the client ping result', async () => {
		expect(await pingSearch(up as SearchClient)).toBe(true);
		expect(await pingSearch(down as SearchClient)).toBe(false);
	});
});
