import type { OcrProvider, OcrAnalysis } from './types';
import { OcrProviderError, OcrTimeoutError } from './types';
import type { KongTokenCache } from './kong-token';

type FetchFn = typeof fetch;

export interface MsDiOpts {
	baseUrl: string;
	modelId: string;
	apiVersion: string;
	tokenCache: KongTokenCache;
	fetch?: FetchFn;
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export class KongMsDiProvider implements OcrProvider {
	readonly modelId: string;
	readonly apiVersion: string;
	private fetch: FetchFn;

	constructor(private opts: MsDiOpts) {
		this.modelId = opts.modelId;
		this.apiVersion = opts.apiVersion;
		this.fetch = opts.fetch ?? fetch;
	}

	async analyze(buf: Buffer, mime: string, _fileName: string): Promise<OcrAnalysis> {
		const token = await this.opts.tokenCache.token();
		const submitUrl = `${this.opts.baseUrl}/documentintelligence/documentModels/${this.modelId}:analyze?api-version=${this.apiVersion}`;
		// Node's fetch accepts a Buffer at runtime; lib.dom's BodyInit is narrower
		// because TS 5.x distinguishes ArrayBuffer from SharedArrayBuffer at the type level.
		const submitRes = await this.fetch(submitUrl, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': mime },
			body: buf as unknown as BodyInit
		});
		if (submitRes.status !== 202) {
			throw new OcrProviderError(`OcrSubmitError_${submitRes.status}`);
		}
		const opUrl = submitRes.headers.get('operation-location');
		if (!opUrl) throw new OcrProviderError('OcrMissingOperationLocation');

		const intervalMs = this.opts.pollIntervalMs ?? 2000;
		const timeoutMs = this.opts.timeoutMs ?? 300_000;
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, intervalMs));
			const pollRes = await this.fetch(opUrl, { headers: { authorization: `Bearer ${token}` } });
			if (!pollRes.ok) throw new OcrProviderError(`OcrPollError_${pollRes.status}`);
			const j = (await pollRes.json()) as {
				status: string;
				analyzeResult?: { content?: string; pages?: unknown[] };
			};
			if (j.status === 'succeeded') {
				const text = j.analyzeResult?.content ?? '';
				return {
					rawText: text,
					pages: j.analyzeResult?.pages?.length ?? null,
					modelId: this.modelId,
					apiVersion: this.apiVersion
				};
			}
			if (j.status === 'failed') throw new OcrProviderError('OcrAnalyzeFailed');
		}
		throw new OcrTimeoutError();
	}
}
