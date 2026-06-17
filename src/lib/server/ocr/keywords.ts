export async function loadKeywords(): Promise<Map<string, Map<string, string | string []>>> {
	 // change to use env variables and parse category json
	const raw = process.env.KEYWORD_JSON ?? undefined;
	if (raw === undefined) {
		throw new Error('Variable KEYWORD_JSON must be defined')
	}
	let keywordMap;
	try {
		keywordMap = JSON.parse(raw) as Map<string, Map<string, string | string []>>;
	} catch (e) {
		throw new Error('Variable KEYWORD_JSON must be valid JSON', {cause: e})
	}
	return keywordMap;
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
