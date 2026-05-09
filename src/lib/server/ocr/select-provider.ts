import path from 'node:path';
import type { OcrProvider } from './types';
import { StubProvider, type StubMode } from './provider-stub';

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
	if (id === 'kong-ms-di') {
		// Real provider lands in Task 15; keep this branch unreachable until then so
		// misconfigured environments surface a clear error instead of silently using the stub.
		throw new Error('OCR_PROVIDER=kong-ms-di is not yet implemented (Task 15)');
	}
	throw new Error(`unknown OCR_PROVIDER: ${id}`);
}
