import { env } from '$env/dynamic/private';

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

const META = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
	return s.replace(META, '\\$&');
}

export function scanKeywords(text: string, keywordMap: Map<string, Map<string, string | string []>>): Map<string, Map<string, number>> { // inner map with category boolean and count
	const hits = new Map<string, Map<string, number>>();
	if (!text || keywordMap.size === 0) return hits;
	const categories = keywordMap.entries();
	for (const [category, info] of categories) {
		hits.set(category,new Map<string, number>().set('count', 0));
		const keywords = info.get('keywords');
		if (keywords) {
			for (const kw of keywords) {
				// Whole-word, case-insensitive. \b only treats ASCII word chars; for our English-only corpus that's fine.
				const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'gi');
				const matches = text.match(re);
				const hitsCategory = hits.get(category);
				const hitsCategoryCount = hitsCategory ? hitsCategory.get('count') ?? 0 : 0
				if (matches && matches.length > 0 && hitsCategory) {
					hitsCategory.set('count', hitsCategoryCount + matches.length)
					hitsCategory.set(kw, matches.length);
				}
			}
		}
	}
	return hits;
}
