import { describe, it, expect } from 'vitest';
import { loadKeywords, scanKeywords } from '$lib/server/ocr/keywords';

describe('keywords', () => {
	it('loads the configured keyword list from the default path', async () => {
		const list = await loadKeywords();
		expect(list).toContain('autism');
		expect(list).toContain('Vineland');
	});

	it('counts case-insensitive whole-word matches', () => {
		const text = 'Autism diagnosis confirmed. AUTISM noted twice. autismatic should not match.';
		const hits = scanKeywords(text, ['autism', 'IEP']);
		expect(hits.get('autism')).toBe(2);
		expect(hits.has('IEP')).toBe(false);
	});

	it('supports multi-word phrases', () => {
		const text = 'Reports include developmental delay and SOCIAL ANXIETY in clinical notes.';
		const hits = scanKeywords(text, ['developmental delay', 'social anxiety', 'autism']);
		expect(hits.get('developmental delay')).toBe(1);
		expect(hits.get('social anxiety')).toBe(1);
		expect(hits.has('autism')).toBe(false);
	});

	it('returns a sparse Map (zero counts excluded)', () => {
		const hits = scanKeywords('nothing relevant here', ['autism', 'BCAAN']);
		expect(hits.size).toBe(0);
	});

	it('escapes regex metacharacters in keywords', () => {
		const hits = scanKeywords('a + b is fine', ['a + b']);
		expect(hits.get('a + b')).toBe(1);
	});

	it('handles empty text and empty keyword list', () => {
		expect(scanKeywords('', ['autism']).size).toBe(0);
		expect(scanKeywords('autism', []).size).toBe(0);
	});
});
