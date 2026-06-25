import { describe, it, expect } from 'vitest';
import { scanKeywords } from '$lib/server/ocr/keywords';
import type { KeywordScanClient } from '$lib/server/search/types';

function makeKeywordMap(categories: Record<string, string[]>): Map<string, Map<string, string | string[]>> {
	const outer = new Map<string, Map<string, string | string[]>>();
	for (const [cat, kws] of Object.entries(categories)) {
		const inner = new Map<string, string | string[]>();
		inner.set('keywords', kws);
		outer.set(cat, inner);
	}
	return outer;
}

function stubClient(hits: Map<string, number>): KeywordScanClient {
	return {
		async scanForKeywords(_text, keywords) {
			const result = new Map<string, number>();
			for (const kw of keywords) {
				const count = hits.get(kw);
				if (count !== undefined) result.set(kw, count);
			}
			return result;
		}
	};
}

describe('scanKeywords', () => {
	it('returns hit counts reported by the scan client', async () => {
		const map = makeKeywordMap({ neurodevelopmental: ['autism', 'IEP'] });
		const client = stubClient(new Map([['autism', 2]]));
		const hits = await scanKeywords('irrelevant text', map, client);
		expect(hits.get('neurodevelopmental')?.get('autism')).toBe(2);
		expect(hits.get('neurodevelopmental')?.has('IEP')).toBe(false);
	});

	it('returns empty map when text is empty', async () => {
		const map = makeKeywordMap({ cat: ['autism'] });
		const client = stubClient(new Map());
		const hits = await scanKeywords('', map, client);
		expect(hits.size).toBe(0);
	});

	it('returns empty outer map when keyword map is empty', async () => {
		const client = stubClient(new Map());
		const hits = await scanKeywords('some text', new Map(), client);
		expect(hits.size).toBe(0);
	});

	it('handles multiple categories independently', async () => {
		const map = makeKeywordMap({
			catA: ['diabetes', 'hypertension'],
			catB: ['autism']
		});
		const client = stubClient(new Map([['diabetes', 3], ['autism', 1]]));
		const hits = await scanKeywords('text', map, client);
		expect(hits.get('catA')?.get('diabetes')).toBe(3);
		expect(hits.get('catA')?.has('hypertension')).toBe(false);
		expect(hits.get('catB')?.get('autism')).toBe(1);
	});
});
