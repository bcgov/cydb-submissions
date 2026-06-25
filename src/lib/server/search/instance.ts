import { env } from '$env/dynamic/private';
import { ManticoreClient } from './manticore';
import type { KeywordScanClient, SearchClient } from './types';

let client: ManticoreClient | null = null;

export function getSearchClient(): SearchClient {
	if (!client) {
		client = new ManticoreClient(env.MANTICORE_URL ?? 'http://localhost:9308');
	}
	return client;
}

export function getKeywordScanClient(): KeywordScanClient {
	if (!client) {
		client = new ManticoreClient(env.MANTICORE_URL ?? 'http://localhost:9308');
	}
	return client;
}
