/** A single submission rendered for indexing. created_at is unix seconds. */
export interface SearchDocument {
	id: number;
	submissionUuid: string;
	status: string;
	createdAt: number;
	surname: string;
	structuredText: string;
	ocrText: string;
	metadataText: string;
}

/** An invalid submission (failed server-side validation) rendered for indexing. */
export interface InvalidSearchDocument {
	id: number;
	submissionUuid: string;
	payloadText: string;
	errorsText: string;
	metadataText: string;
	receivedAt: number;
}

/** Normalised search request handed to a SearchClient. */
export interface SearchInput {
	/** Raw user query in Manticore extended syntax. */
	match: string;
	/** status = X (exact-status filter), if any. */
	statusEquals?: string;
	/** status != X (e.g. exclude_invalid), if any. */
	statusNotEquals?: string;
	limit: number;
	offset: number;
	fuzzy: boolean;
	fuzzyDistance: number;
}

export interface SearchHit {
	id: number;
	weight: number;
	snippet: string;
}

export interface SearchResult {
	hits: SearchHit[];
	total: number;
}

/** Thrown when the engine rejects a malformed query; surfaced to the user. */
export class SearchQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SearchQueryError';
	}
}

export interface SearchClient {
	/** Idempotently create the submissions index if absent. */
	ensureIndex(): Promise<void>;
	/** Idempotently create the invalid submissions index if absent. */
	ensureInvalidIndex(): Promise<void>;
	replaceDoc(doc: SearchDocument): Promise<void>;
	deleteDoc(id: number): Promise<void>;
	search(input: SearchInput): Promise<SearchResult>;
	replaceInvalidDoc(doc: InvalidSearchDocument): Promise<void>;
	deleteInvalidDoc(id: number): Promise<void>;
	searchInvalid(input: SearchInput): Promise<SearchResult>;
	/** Health check for the readiness probe. */
	ping(): Promise<boolean>;
}
