import { env } from '$env/dynamic/private';
import type { KeywordScanClient } from '../search/types';

let keywordMap: Map<string, Map<string, string | string []>> | undefined = undefined;
let categoryMap: Map<string, string> | undefined = undefined;

// @ts-expect-error implicit any typing required for this recursive function to work arbitrarily
function nestedObjToMap(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
	// @ts-expect-error implicit any typing required for this recursive function to work arbitrarily
    return obj.map(item => nestedObjToMap(item));
  }
  const map = new Map();
  for (const [key, value] of Object.entries(obj)) {
    map.set(key, nestedObjToMap(value));
  }
  return map;
}

export async function loadKeywords(): Promise<Map<string, Map<string, string | string []>>> {
	if (typeof keywordMap !== 'undefined') {
		return keywordMap;
	}
	const raw = env.KEYWORD_JSON ?? undefined;
	if (raw === undefined) {
		throw new Error('Variable KEYWORD_JSON must be defined')
	}
	try {
		keywordMap = JSON.parse(raw) as Map<string, Map<string, string | string []>>;
		keywordMap = nestedObjToMap(keywordMap);
	} catch (e) {
		throw new Error('Variable KEYWORD_JSON must be valid JSON', {cause: e})
	}
	return keywordMap as Map<string, Map<string, string | string []>>;
}

export async function getCategoryMapping(): Promise<Map<string, string>> {
	if (typeof categoryMap !== 'undefined') {
		return categoryMap;
	}
	const keywordMap = await loadKeywords();
	categoryMap = new Map<string, string>();
	for (const [category, info] of keywordMap) {
		categoryMap.set(category, info.get('name') as string ?? 'Undefined');
	}
	return categoryMap;
}

export async function scanKeywords(
	text: string,
	keywordMap: Map<string, Map<string, string | string[]>>,
	client: KeywordScanClient
): Promise<Map<string, Map<string, number>>> {
	const hits = new Map<string, Map<string, number>>();
	if (!text || keywordMap.size === 0) return hits;

	const allKeywords: Array<{ category: string; keyword: string }> = [];
	for (const [category, info] of keywordMap) {
		hits.set(category, new Map<string, number>());
		const keywords = info.get('keywords');
		if (Array.isArray(keywords)) {
			for (const kw of keywords as string[]) {
				allKeywords.push({ category, keyword: kw });
			}
		}
	}

	if (allKeywords.length === 0) return hits;

	const kwHits = await client.scanForKeywords(text, allKeywords.map((k) => k.keyword));
	for (const { category, keyword } of allKeywords) {
		const count = kwHits.get(keyword);
		if (count !== undefined && count > 0) {
			hits.get(category)!.set(keyword, count);
		}
	}
	return hits;
}
