import path from 'node:path';
import type { OcrProvider, OcrAnalysis } from './types';
import { OcrProviderError, OcrTimeoutError } from './types';

type FetchFn = typeof fetch;

export interface BcgovDiOpts {
	baseUrl: string;
	apiKey: string;
	workflowSlug: string;
	modelId: string;
	fetch?: FetchFn;
	pollIntervalMs?: number;
	timeoutMs?: number;
}

const MIME_TO_FILE_TYPE: Record<string, string> = {
	'application/pdf': 'pdf',
	'image/jpeg': 'image',
	'image/jpg': 'image',
	'image/png': 'image',
	'image/heic': 'image',
	'image/heif': 'image',
	'image/tiff': 'image'
};

function mimeToFileType(mime: string): string {
	const mapped = MIME_TO_FILE_TYPE[mime.toLowerCase()];
	if (mapped) return mapped;
	return 'bin';
}

export class BcgovDiProvider implements OcrProvider {
	readonly modelId: string;
	readonly apiVersion = 'bcgov-di-ocr-only-minimal';
	private fetch: FetchFn;

	constructor(private opts: BcgovDiOpts) {
		this.modelId = opts.modelId;
		this.fetch = opts.fetch ?? fetch;
	}

	async analyze(buf: Buffer, mime: string, fileName: string, submissionId?: number, assessmentIndex?: number| null): Promise<OcrAnalysis> {
		const headers = { 'x-api-key': this.opts.apiKey, 'content-type': 'application/json' };
		const uploadRes = await this.fetch(`${this.opts.baseUrl}/api/upload`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				title: `${submissionId ?? '-1'}-${fileName}-${assessmentIndex ?? '-1'}`,
				file: buf.toString('base64'),
				file_type: mimeToFileType(mime),
				original_filename: fileName,
				workflow_slug: this.opts.workflowSlug
			})
		});
		if (!uploadRes.ok) {
			throw new OcrProviderError(`OcrSubmitError_${uploadRes.status}`);
		}
		const uploadJson = (await uploadRes.json()) as { document?: { id?: string; status?: string } };
		const docId = uploadJson.document?.id;
		if (!docId) throw new OcrProviderError('OcrMissingDocumentId');

		const intervalMs = this.opts.pollIntervalMs ?? 2000;
		const timeoutMs = this.opts.timeoutMs ?? 300_000;
		const deadline = Date.now() + timeoutMs;
		const docUrl = `${this.opts.baseUrl}/api/documents/${encodeURIComponent(docId)}`;

		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, intervalMs));
			const pollRes = await this.fetch(docUrl, { headers: { 'x-api-key': this.opts.apiKey } });
			if (!pollRes.ok) throw new OcrProviderError(`OcrPollError_${pollRes.status}`);
			const j = (await pollRes.json()) as { status?: string };
			const status = (j.status ?? '').toLowerCase();
			if (status === 'failed' || status === 'error' || status === 'errored') {
				throw new OcrProviderError('OcrAnalyzeFailed');
			}
			if (status && status !== 'ongoing_ocr' && status !== 'pending' && status !== 'queued' && status !== 'running') {
				break;
			}
		}
		if (Date.now() >= deadline) throw new OcrTimeoutError();

		const resultRes = await this.fetch(`${docUrl}/ocr`, {
			headers: { 'x-api-key': this.opts.apiKey }
		});
		if (!resultRes.ok) throw new OcrProviderError(`OcrResultFetchError_${resultRes.status}`);
		const result = (await resultRes.json()) as {
			ocr_result?: { content?: { text?: string; pages?: unknown[] } };
		};
		const content = result.ocr_result?.content;
		return {
			rawText: content?.text ?? '',
			pages: content?.pages?.length ?? null,
			modelId: this.modelId,
			apiVersion: this.apiVersion
		};
	}
}
