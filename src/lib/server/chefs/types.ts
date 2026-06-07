export interface ChefsConfig {
	formId: string;
	apiToken: string;
	version: string;
	baseUrl: string;
	fileComponents: string[];
	apiParams: Record<string, unknown>;
	pollerEnabled: boolean;
	pollIntervalMs: number;
}

export type ChefsConfigInput = Partial<Omit<ChefsConfig, 'apiToken'>> & {
	apiToken?: string;
};

export interface ChefsRedactedConfig {
	formId: string;
	apiTokenSet: boolean;
	apiTokenSource: 'db' | 'env' | 'none';
	version: string;
	baseUrl: string;
	fileComponents: string[];
	apiParams: Record<string, unknown>;
	pollerEnabled: boolean;
	pollIntervalMs: number;
	envOverrides: Array<keyof ChefsConfig>;
}

export interface ChefsFileRef {
	fileId: string;
	originalName: string;
	assessmentIndex?: number; // set when the file came from an editGrid row
}

export interface ChefsSubmissionRaw {
	form: {
		submissionId?: string;
		confirmationId?: string;
		[k: string]: unknown;
	};
	[componentKey: string]: unknown;
}

export type ChefsErrorClass =
	| 'ConfigMissing'
	| 'Unauthorized'
	| 'NotFound'
	| 'NetworkError'
	| 'BadResponse';

export class ChefsClientError extends Error {
	constructor(
		public errorClass: ChefsErrorClass,
		message: string,
		public status?: number,
		public bodyExcerpt?: string
	) {
		super(message);
		this.name = 'ChefsClientError';
	}
}

export interface SyncResult {
	startedAt: string;
	finishedAt: string;
	fetched: number;
	ingested: number;
	invalid: number;
	skippedDuplicate: number;
	errors: Array<{ submissionUuid?: string; message: string }>;
}
