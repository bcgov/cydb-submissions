export interface OcrAnalysis {
	rawText: string;
	pages: number | null;
	modelId: string;
	apiVersion: string;
}

export class OcrError extends Error {
	constructor(public readonly errorClass: string, message?: string) {
		super(message ?? errorClass);
		this.name = 'OcrError';
	}
}

export class OcrTimeoutError extends OcrError {
	constructor() {
		super('OcrTimeoutError');
	}
}

export class OcrProviderError extends OcrError {
	constructor(klass = 'OcrProviderError') {
		super(klass);
	}
}

export interface OcrProvider {
	readonly modelId: string;
	readonly apiVersion: string;
	analyze(buf: Buffer, mimeType: string, fileName: string): Promise<OcrAnalysis>;
}
