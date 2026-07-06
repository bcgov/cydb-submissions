import type { SearchClient, SearchDocument, InvalidSearchDocument, SearchInput, SearchResult } from './types';

/**
 * Test double. Naive AND-of-substrings matching over the concatenated fields.
 * It deliberately ignores advanced operators (wildcards, phrases, fuzzy) — unit
 * tests exercise those against the real ManticoreClient / integration test.
 */
export class InMemorySearchClient implements SearchClient {
	private docs = new Map<number, SearchDocument>();
	private invalidDocs = new Map<number, InvalidSearchDocument>();

	async ensureIndex(): Promise<void> {}
	async ensureInvalidIndex(): Promise<void> {}
	async dropIndex(): Promise<void> {}
	async dropInvalidIndex(): Promise<void> {}
	async ping(): Promise<boolean> { return true; }

	async replaceDoc(doc: SearchDocument): Promise<void> {
		this.docs.set(doc.id, doc);
	}

	async deleteDoc(id: number): Promise<void> {
		this.docs.delete(id);
	}

	async replaceInvalidDoc(doc: InvalidSearchDocument): Promise<void> {
		this.invalidDocs.set(doc.id, doc);
	}

	async deleteInvalidDoc(id: number): Promise<void> {
		this.invalidDocs.delete(id);
	}

	async search(input: SearchInput): Promise<SearchResult> {
		const terms = input.match.toLowerCase().split(/\s+/).map((t) => t.replace(/[*"@/+-]/g, '')).filter(Boolean);
		const matched = [...this.docs.values()].filter((d) => {
			if (input.statusEquals && d.status !== input.statusEquals) return false;
			if (input.statusNotEquals && d.status === input.statusNotEquals) return false;
			const hay = `${d.surname} ${d.structuredText} ${d.ocrText} ${d.metadataText}`.toLowerCase();
			return terms.every((t) => hay.includes(t));
		});
		matched.sort((a, b) => a.id - b.id);
		const page = matched.slice(input.offset, input.offset + input.limit);
		return {
			total: matched.length,
			hits: page.map((d) => ({ id: d.id, weight: 1, snippet: snippetFor(`${d.ocrText} ${d.structuredText} ${d.surname}`, terms) }))
		};
	}

	async searchInvalid(input: SearchInput): Promise<SearchResult> {
		const terms = input.match.toLowerCase().split(/\s+/).map((t) => t.replace(/[*"@/+-]/g, '')).filter(Boolean);
		const matched = [...this.invalidDocs.values()].filter((d) => {
			const hay = `${d.payloadText} ${d.errorsText} ${d.metadataText}`.toLowerCase();
			return terms.every((t) => hay.includes(t));
		});
		matched.sort((a, b) => a.id - b.id);
		const page = matched.slice(input.offset, input.offset + input.limit);
		return {
			total: matched.length,
			hits: page.map((d) => ({ id: d.id, weight: 1, snippet: snippetFor(`${d.payloadText} ${d.errorsText}`, terms) }))
		};
	}
}

function snippetFor(text: string, terms: string[]): string {
	const lower = text.toLowerCase();
	const at = terms.length ? lower.indexOf(terms[0]) : -1;
	if (at < 0) return text.slice(0, 120);
	const start = Math.max(0, at - 30);
	return text.slice(start, start + 120);
}
