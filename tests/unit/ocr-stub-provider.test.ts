import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { StubProvider } from '$lib/server/ocr/provider-stub';

const fixtureDir = path.resolve('tests/fixtures/ocr');

describe('StubProvider', () => {
	it('mode=stub returns the matching fixture', async () => {
		const p = new StubProvider({ mode: 'stub', fixtureDir, delayMs: 0 });
		const r = await p.analyze(Buffer.from(''), 'application/pdf', 'sample-1.pdf');
		expect(r.rawText).toContain('Vineland');
		expect(r.modelId).toBe('stub');
	});
	it('mode=stub-fail always throws OcrProviderError', async () => {
		const p = new StubProvider({ mode: 'stub-fail', fixtureDir, delayMs: 0 });
		await expect(p.analyze(Buffer.from(''), 'application/pdf', 'x.pdf')).rejects.toThrow(/OcrProviderError/);
	});
	it('mode=stub-flaky fails N times then succeeds', async () => {
		const p = new StubProvider({ mode: 'stub-flaky', fixtureDir, delayMs: 0, flakyFailures: 2 });
		await expect(p.analyze(Buffer.from(''), 'application/pdf', 'sample-2.pdf')).rejects.toThrow();
		await expect(p.analyze(Buffer.from(''), 'application/pdf', 'sample-2.pdf')).rejects.toThrow();
		const r = await p.analyze(Buffer.from(''), 'application/pdf', 'sample-2.pdf');
		expect(r.rawText.length).toBeGreaterThan(0);
	});
	it('falls back to a synthesized string when no matching fixture exists', async () => {
		const p = new StubProvider({ mode: 'stub', fixtureDir, delayMs: 0 });
		const r = await p.analyze(Buffer.from(''), 'application/pdf', 'unknown-file.pdf');
		expect(r.rawText).toContain('unknown-file.pdf');
	});
});
