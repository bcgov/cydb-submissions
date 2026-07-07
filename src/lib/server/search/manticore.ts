import {
	SearchQueryError,
	type SearchClient,
	type SearchDocument,
	type InvalidSearchDocument,
	type SearchInput,
	type SearchResult
} from './types';

const INDEX = 'submissions_idx';
const INVALID_INDEX = 'invalid_submissions_idx';
const HIGHLIGHT_FIELDS = ['ocr_text', 'structured_text', 'surname', 'metadata_text'];
const INVALID_HIGHLIGHT_FIELDS = ['payload_text', 'errors_text', 'metadata_text'];

function esc(v: string): string {
	// Manticore SQL string literals use BACKSLASH escaping — it does NOT support
	// SQL-standard '' quote doubling (doubling is parsed as two adjacent strings
	// → "unexpected string" syntax error). Escape backslashes first, then quotes,
	// so document content (e.g. OCR text containing "Children's") can neither break
	// nor inject into the REPLACE statement.
	return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class ManticoreClient implements SearchClient {
	constructor(private baseUrl: string) {}

	private async sql(query: string): Promise<unknown> {
		const res = await fetch(`${this.baseUrl}/sql?mode=raw`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: `query=${encodeURIComponent(query)}`
		});
		const json = (await res.json().catch(() => null)) as unknown;
		const err = sqlError(json);
		if (!res.ok || err) {
			throw new Error(`manticore sql failed: ${res.status} ${err ?? JSON.stringify(json)}`);
		}
		return json;
	}

	async ensureIndex(): Promise<void> {
		await this.sql(
			`CREATE TABLE IF NOT EXISTS ${INDEX} (` +
				`surname text, structured_text text, ocr_text text, metadata_text text, ` +
				`submission_uuid string, status string, created_at timestamp` +
				`) morphology='lemmatize_en_all' min_infix_len='2' index_exact_words='1'`
		);
	}

	async ensureInvalidIndex(): Promise<void> {
		await this.sql(
			`CREATE TABLE IF NOT EXISTS ${INVALID_INDEX} (` +
				`payload_text text, errors_text text, metadata_text text, ` +
				`submission_uuid string, received_at timestamp` +
				`) morphology='lemmatize_en_all' min_infix_len='2' index_exact_words='1'`
		);
	}

	async replaceDoc(doc: SearchDocument): Promise<void> {
		await this.sql(
			`REPLACE INTO ${INDEX} (id, surname, structured_text, ocr_text, metadata_text, submission_uuid, status, created_at) VALUES (` +
				`${doc.id}, '${esc(doc.surname)}', '${esc(doc.structuredText)}', '${esc(doc.ocrText)}', '${esc(doc.metadataText)}', ` +
				`'${esc(doc.submissionUuid)}', '${esc(doc.status)}', ${doc.createdAt})`
		);
	}

	async replaceInvalidDoc(doc: InvalidSearchDocument): Promise<void> {
		await this.sql(
			`REPLACE INTO ${INVALID_INDEX} (id, payload_text, errors_text, metadata_text, submission_uuid, received_at) VALUES (` +
				`${doc.id}, '${esc(doc.payloadText)}', '${esc(doc.errorsText)}', '${esc(doc.metadataText)}', ` +
				`'${esc(doc.submissionUuid)}', ${doc.receivedAt})`
		);
	}

	async deleteDoc(id: number): Promise<void> {
		await this.sql(`DELETE FROM ${INDEX} WHERE id=${id}`);
	}

	async deleteInvalidDoc(id: number): Promise<void> {
		await this.sql(`DELETE FROM ${INVALID_INDEX} WHERE id=${id}`);
	}

	async search(input: SearchInput): Promise<SearchResult> {
		return this._search(INDEX, HIGHLIGHT_FIELDS, input);
	}

	async searchInvalid(input: SearchInput): Promise<SearchResult> {
		// Invalid submissions have no status field — ignore status filter params.
		return this._search(INVALID_INDEX, INVALID_HIGHLIGHT_FIELDS, {
			...input,
			statusEquals: undefined,
			statusNotEquals: undefined
		});
	}

	private async _search(
		index: string,
		highlightFields: string[],
		input: SearchInput
	): Promise<SearchResult> {
		validateQuery(input.match);
		const must: unknown[] = [{ query_string: input.match }];
		const mustNot: unknown[] = [];
		if (input.statusEquals) must.push({ equals: { status: input.statusEquals } });
		if (input.statusNotEquals) mustNot.push({ equals: { status: input.statusNotEquals } });

		const body: Record<string, unknown> = {
			index,
			query: { bool: { must, ...(mustNot.length ? { must_not: mustNot } : {}) } },
			highlight: { fields: highlightFields, limit: 1 },
			limit: input.limit,
			offset: input.offset
		};
		if (input.fuzzy) body.options = { fuzzy: 1, fuzzy_search_distance: input.fuzzyDistance };

		const res = await fetch(`${this.baseUrl}/search`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const json = (await res.json().catch(() => null)) as {
			error?: string;
			hits?: {
				total?: number;
				hits?: Array<{
					_id: number | string;
					_score?: number;
					highlight?: Record<string, string[]>;
				}>;
			};
		} | null;

		if (!res.ok || !json || json.error) {
			throw new SearchQueryError(json?.error ?? `search failed (${res.status})`);
		}

		const rawHits = json.hits?.hits ?? [];
		return {
			total: json.hits?.total ?? rawHits.length,
			hits: rawHits.map((h) => ({
				id: Number(h._id),
				weight: h._score ?? 0,
				snippet: firstHighlight(h.highlight, highlightFields)
			}))
		};
	}

	async ping(): Promise<boolean> {
		try {
			await this.sql('SHOW TABLES');
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Catches common query syntax mistakes and throws a SearchQueryError with a
 * user-readable message before the query reaches Manticore.
 */
function validateQuery(query: string): void {
	// NEAR/N at end of query — missing right-hand operand
	if (/NEAR\/\d+\s*$/i.test(query.trim())) {
		throw new SearchQueryError(
			'NEAR/N requires terms on both sides — e.g. onychophagy NEAR/3 nailbiting'
		);
	}
}

/**
 * Manticore's /sql endpoint returns HTTP 200 even on DDL/DML errors, signalling
 * failure via a non-empty `error` field — usually inside a single-element array
 * ([{ error: "..." }]), sometimes a bare object. Returns the error string, or
 * null when there is no error (including the empty-string `error` of a success).
 */
function sqlError(json: unknown): string | null {
	const row = Array.isArray(json) ? json[0] : json;
	if (row && typeof row === 'object' && 'error' in row) {
		const e = (row as { error?: unknown }).error;
		if (typeof e === 'string' && e.length > 0) return e;
	}
	return null;
}

function firstHighlight(h: Record<string, string[]> | undefined, fields: string[]): string {
	if (!h) return '';
	for (const field of fields) {
		if (h[field]?.length) return h[field][0];
	}
	const any = Object.values(h)[0];
	return any?.[0] ?? '';
}
