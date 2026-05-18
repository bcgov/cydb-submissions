import { describe, it, expect } from 'vitest';
import { selectProvider } from '$lib/server/ocr/select-provider';
import { BcgovDiProvider } from '$lib/server/ocr/provider-bcgov-di';
import { StubProvider } from '$lib/server/ocr/provider-stub';

describe('selectProvider', () => {
	it('defaults to the stub provider when OCR_PROVIDER is unset', () => {
		const p = selectProvider({});
		expect(p).toBeInstanceOf(StubProvider);
	});

	it('returns a BcgovDiProvider when OCR_PROVIDER=bcgov-di and all required env present', () => {
		const p = selectProvider({
			OCR_PROVIDER: 'bcgov-di',
			BCGOV_DI_BASE_URL: 'https://di.test',
			BCGOV_DI_API_KEY: 'abc'
		});
		expect(p).toBeInstanceOf(BcgovDiProvider);
		expect(p.modelId).toBe('prebuilt-read');
	});

	it('throws when BCGOV_DI_BASE_URL is missing', () => {
		expect(() =>
			selectProvider({ OCR_PROVIDER: 'bcgov-di', BCGOV_DI_API_KEY: 'abc' })
		).toThrow(/BCGOV_DI_BASE_URL/);
	});

	it('throws when BCGOV_DI_API_KEY is missing', () => {
		expect(() =>
			selectProvider({ OCR_PROVIDER: 'bcgov-di', BCGOV_DI_BASE_URL: 'https://di.test' })
		).toThrow(/BCGOV_DI_API_KEY/);
	});

	it('throws for an unknown provider id', () => {
		expect(() => selectProvider({ OCR_PROVIDER: 'mystery' })).toThrow(/unknown OCR_PROVIDER/);
	});
});
