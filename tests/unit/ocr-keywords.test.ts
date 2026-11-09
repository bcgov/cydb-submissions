import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanKeywords } from '$lib/server/ocr/keywords';

type KeywordMap = Map<string, Map<string, string | string[]>>;

function kwMap(categories: Record<string, string[]>): KeywordMap {
	const m: KeywordMap = new Map();
	for (const [category, keywords] of Object.entries(categories)) {
		m.set(
			category,
			new Map<string, string | string[]>([
				['name', category],
				['keywords', keywords]
			])
		);
	}
	return m;
}

describe('keywords', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('loads the keyword map from KEYWORD_JSON and converts objects to Maps', async () => {
		vi.doMock('$env/dynamic/private', () => ({
			env: {
				KEYWORD_JSON: JSON.stringify({
					category1: { name: 'Diagnosis', keywords: ['autism', 'Vineland'] }
				})
			}
		}));
		const { loadKeywords, getCategoryMapping } = await import('$lib/server/ocr/keywords');
		const map = await loadKeywords();
		expect(map.get('category1')?.get('keywords')).toEqual(['autism', 'Vineland']);
		expect((await getCategoryMapping()).get('category1')).toBe('Diagnosis');
	});

	it('throws when KEYWORD_JSON is missing', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const { loadKeywords } = await import('$lib/server/ocr/keywords');
		await expect(loadKeywords()).rejects.toThrow('KEYWORD_JSON must be defined');
	});

	it('throws when KEYWORD_JSON is not valid JSON', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: { KEYWORD_JSON: '{nope' } }));
		const { loadKeywords } = await import('$lib/server/ocr/keywords');
		await expect(loadKeywords()).rejects.toThrow('KEYWORD_JSON must be valid JSON');
	});

	it('counts case-insensitive whole-word matches per category', () => {
		const text = 'Autism diagnosis confirmed. AUTISM noted twice. autismatic should not match.';
		const hits = scanKeywords(text, kwMap({ category1: ['autism', 'IEP'] }));
		expect(hits.get('category1')?.get('autism')).toBe(2);
		expect(hits.get('category1')?.has('IEP')).toBe(false);
	});

	it('supports multi-word phrases', () => {
		const text = 'Reports include developmental delay and SOCIAL ANXIETY in clinical notes.';
		const hits = scanKeywords(
			text,
			kwMap({ category1: ['developmental delay', 'social anxiety', 'autism'] })
		);
		const c1 = hits.get('category1');
		expect(c1?.get('developmental delay')).toBe(1);
		expect(c1?.get('social anxiety')).toBe(1);
		expect(c1?.has('autism')).toBe(false);
	});

	it('records counts separately for each category', () => {
		const hits = scanKeywords(
			'autism and IEP',
			kwMap({ category1: ['autism'], category2: ['IEP'] })
		);
		expect(hits.get('category1')?.get('autism')).toBe(1);
		expect(hits.get('category2')?.get('IEP')).toBe(1);
	});

	it('returns sparse per-category maps (zero counts excluded)', () => {
		const hits = scanKeywords('nothing relevant here', kwMap({ category1: ['autism', 'BCAAN'] }));
		expect(hits.get('category1')?.size).toBe(0);
	});

	it('escapes regex metacharacters in keywords', () => {
		const hits = scanKeywords('a + b is fine', kwMap({ category1: ['a + b'] }));
		expect(hits.get('category1')?.get('a + b')).toBe(1);
	});

	it('handles empty text and empty keyword map', () => {
		expect(scanKeywords('', kwMap({ category1: ['autism'] })).size).toBe(0);
		expect(scanKeywords('autism', new Map()).size).toBe(0);
	});
});
