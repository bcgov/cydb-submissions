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
const HIGHLIGHT_FIELDS = ['ocr_text', 'structured_text', 'surname', 'child_first_name', 'child_last_name', 'metadata_text'];
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
				`surname text, child_first_name text, child_last_name text, structured_text text, ocr_text text, metadata_text text, ` +
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
			`REPLACE INTO ${INDEX} (id, surname, child_first_name, child_last_name, structured_text, ocr_text, metadata_text, submission_uuid, status, created_at) VALUES (` +
				`${doc.id}, '${esc(doc.surname)}', '${esc(doc.childFirstName)}', '${esc(doc.childLastName)}', '${esc(doc.structuredText)}', '${esc(doc.ocrText)}', '${esc(doc.metadataText)}', ` +
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

	async dropIndex(): Promise<void> {
		await this.sql(`DROP TABLE IF EXISTS ${INDEX}`);
	}

	async dropInvalidIndex(): Promise<void> {
		await this.sql(`DROP TABLE IF EXISTS ${INVALID_INDEX}`);
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

		const conditions: string[] = [`MATCH('${esc(input.match)}')`];
		if (input.statusEquals) conditions.push(`status = '${esc(input.statusEquals)}'`);
		if (input.statusNotEquals) conditions.push(`status != '${esc(input.statusNotEquals)}'`);
		const where = conditions.join(' AND ');
		const hasQuorum = /"[^"]*"\/\d+/.test(input.match);
		const optClause = (input.fuzzy && !hasQuorum) ? ' OPTION fuzzy=1' : '';
		const hlFields = highlightFields.join(',');

		let rawIds: unknown;
		let rawCount: unknown;
		try {
			[rawIds, rawCount] = await Promise.all([
				this.sql(
					`SELECT id, WEIGHT() as weight ` +
						`FROM ${index} WHERE ${where} ` +
						`LIMIT ${input.limit} OFFSET ${input.offset}${optClause}`
				),
				this.sql(`SELECT COUNT(*) as n FROM ${index} WHERE ${where}${optClause}`)
			]);
		} catch (e) {
			const msg = e instanceof Error
				? e.message.replace(/^manticore sql failed: \S+ /, '')
				: String(e);
			throw new SearchQueryError(msg);
		}

		type IdRow = { id: number | string; weight?: number };
		type CountRow = { n?: number };
		const idsData = (rawIds as Array<{ data?: IdRow[] }>)[0]?.data ?? [];
		const countData = (rawCount as Array<{ data?: CountRow[] }>)[0]?.data ?? [];

		// Fetch snippets in a separate query without OPTION fuzzy so HIGHLIGHT()
		// does not interfere with row retrieval.
		const snippetMap = new Map<number, string>();
		if (idsData.length) {
			try {
				const idList = idsData.map((r) => Number(r.id)).join(',');
				const rawSnippets = await this.sql(
					`SELECT id, HIGHLIGHT({limit=200}, '${hlFields}') as snippet ` +
						`FROM ${index} WHERE id IN (${idList}) AND MATCH('${esc(positiveOnly(input.match))}')`
				);
				type SnippetRow = { id: number | string; snippet?: string };
				for (const r of ((rawSnippets as Array<{ data?: SnippetRow[] }>)[0]?.data ?? [])) {
					snippetMap.set(Number(r.id), r.snippet ?? '');
				}
			} catch {
				// Snippet generation is best-effort; don't fail the search if it errors.
			}
		}

		return {
			total: countData[0]?.n ?? idsData.length,
			hits: idsData.map((r) => ({
				id: Number(r.id),
				weight: r.weight ?? 0,
				snippet: snippetMap.get(Number(r.id)) ?? ''
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

/** Strip -word and -"phrase" tokens, returning only the positive terms. */
function positiveOnly(query: string): string {
	return (query.match(/-?"[^"]*"(?:\/\d+)?|-?\S+/g) ?? [])
		.filter((tok) => !tok.startsWith('-'))
		.join(' ');
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
