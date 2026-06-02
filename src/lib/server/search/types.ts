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
	/** Idempotently create the index if absent. */
	ensureIndex(): Promise<void>;
	replaceDoc(doc: SearchDocument): Promise<void>;
	deleteDoc(id: number): Promise<void>;
	search(input: SearchInput): Promise<SearchResult>;
	/** Health check for the readiness probe. */
	ping(): Promise<boolean>;
}
