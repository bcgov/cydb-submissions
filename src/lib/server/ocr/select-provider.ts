import path from 'node:path';
import type { OcrProvider } from './types';
import { StubProvider, type StubMode } from './provider-stub';
import { KongMsDiProvider } from './provider-kong-msdi';
import { KongTokenCache } from './kong-token';
import { BcgovDiProvider } from './provider-bcgov-di';

export interface ProviderEnv {
	OCR_PROVIDER?: string;
	OCR_STUB_FIXTURES?: string;
	OCR_STUB_FLAKY_FAILURES?: string;
	KONG_BASE_URL?: string;
	KONG_TOKEN_URL?: string;
	KONG_CLIENT_ID?: string;
	KONG_CLIENT_SECRET?: string;
	OCR_MODEL_ID?: string;
	AZURE_DI_API_VERSION?: string;
	BCGOV_DI_BASE_URL?: string;
	BCGOV_DI_API_KEY?: string;
	BCGOV_DI_WORKFLOW_SLUG?: string;
}

export function selectProvider(env: ProviderEnv): OcrProvider {
	const id = env.OCR_PROVIDER ?? 'stub';
	if (id === 'stub' || id === 'stub-fail' || id === 'stub-flaky') {
		return new StubProvider({
			mode: id as StubMode,
			fixtureDir: env.OCR_STUB_FIXTURES ?? path.resolve('tests/fixtures/ocr'),
			delayMs: 0,
			flakyFailures: env.OCR_STUB_FLAKY_FAILURES ? Number(env.OCR_STUB_FLAKY_FAILURES) : 1
		});
	}
	if (id === 'bcgov-di') {
		const baseUrl = env.BCGOV_DI_BASE_URL;
		const apiKey = env.BCGOV_DI_API_KEY;
		if (!baseUrl) throw new Error('BCGOV_DI_BASE_URL is required for OCR_PROVIDER=bcgov-di');
		if (!apiKey) throw new Error('BCGOV_DI_API_KEY is required for OCR_PROVIDER=bcgov-di');
		return new BcgovDiProvider({
			baseUrl,
			apiKey,
			workflowSlug: env.BCGOV_DI_WORKFLOW_SLUG ?? 'ocr-only-minimal',
			modelId: env.OCR_MODEL_ID ?? 'prebuilt-read'
		});
	}
	if (id === 'kong-ms-di') {
		const baseUrl = env.KONG_BASE_URL;
		const tokenUrl = env.KONG_TOKEN_URL;
		const clientId = env.KONG_CLIENT_ID;
		const clientSecret = env.KONG_CLIENT_SECRET;
		if (!baseUrl) throw new Error('KONG_BASE_URL is required for OCR_PROVIDER=kong-ms-di');
		if (!tokenUrl || !clientId || !clientSecret) {
			throw new Error('KONG_TOKEN_URL, KONG_CLIENT_ID, KONG_CLIENT_SECRET are required for OCR_PROVIDER=kong-ms-di');
		}
		const tokenCache = new KongTokenCache({ tokenUrl, clientId, clientSecret });
		return new KongMsDiProvider({
			baseUrl,
			modelId: env.OCR_MODEL_ID ?? 'prebuilt-read',
			apiVersion: env.AZURE_DI_API_VERSION ?? '2024-11-30',
			tokenCache
		});
	}
	throw new Error(`unknown OCR_PROVIDER: ${id}`);
}
