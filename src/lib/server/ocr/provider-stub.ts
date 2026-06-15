import path from 'node:path';
import fs from 'node:fs/promises';
import type { OcrAnalysis, OcrProvider } from './types';
import { OcrProviderError } from './types';

export type StubMode = 'stub' | 'stub-fail' | 'stub-flaky';

export interface StubOpts {
	mode: StubMode;
	fixtureDir: string;
	delayMs?: number;
	flakyFailures?: number;
}

export class StubProvider implements OcrProvider {
	readonly modelId = 'stub';
	readonly apiVersion = 'stub-1';
	private flakyCount = 0;

	constructor(private opts: StubOpts) {}

	async analyze(_buf: Buffer, _mime: string, fileName: string, _submissionId?: number, _assessmentIndex?: number | null): Promise<OcrAnalysis> {
		if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
		if (this.opts.mode === 'stub-fail') throw new OcrProviderError('OcrProviderError');
		if (this.opts.mode === 'stub-flaky') {
			if (this.flakyCount < (this.opts.flakyFailures ?? 1)) {
				this.flakyCount++;
				throw new OcrProviderError('OcrProviderError');
			}
		}
		const base = path.basename(fileName, path.extname(fileName));
		const fixture = path.join(this.opts.fixtureDir, `${base}.txt`);
		let text: string;
		try {
			text = await fs.readFile(fixture, 'utf8');
		} catch {
			text = `Stub OCR for ${fileName}`;
		}
		return { rawText: text, pages: 1, modelId: this.modelId, apiVersion: this.apiVersion };
	}
}
