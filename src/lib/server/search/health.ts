import type { SearchClient } from './types';

export async function pingSearch(client: SearchClient): Promise<boolean> {
	try {
		return await client.ping();
	} catch {
		return false;
	}
}
