import { env } from '$env/dynamic/private';
import { ManticoreClient } from './manticore';
import type { SearchClient } from './types';

let client: SearchClient | null = null;

export function getSearchClient(): SearchClient {
	if (!client) {
		client = new ManticoreClient(env.MANTICORE_URL ?? 'http://localhost:9308');
	}
	return client;
}
