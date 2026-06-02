import { describe, it, expect } from 'vitest';
import { InMemorySearchClient } from '$lib/server/search/stub';
import type { SearchDocument } from '$lib/server/search/types';

function doc(over: Partial<SearchDocument>): SearchDocument {
	return {
		id: 1, submissionUuid: 'u1', status: 'submitted', createdAt: 1000,
		surname: 'Smith', structuredText: 'language English', ocrText: 'autism speech delay',
		metadataText: 'UA Mozilla', ...over
	};
}

describe('InMemorySearchClient', () => {
	it('pings true and ensureIndex is a no-op', async () => {
		const c = new InMemorySearchClient();
		expect(await c.ping()).toBe(true);
		await c.ensureIndex();
	});

	it('matches a plain term across fields and returns a snippet', async () => {
		const c = new InMemorySearchClient();
		await c.replaceDoc(doc({ id: 1 }));
		await c.replaceDoc(doc({ id: 2, ocrText: 'no relevant text', surname: 'Jones' }));
		const r = await c.search({ match: 'autism', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.total).toBe(1);
		expect(r.hits[0].id).toBe(1);
		expect(r.hits[0].snippet).toContain('autism');
	});

	it('requires all bare terms (AND semantics)', async () => {
		const c = new InMemorySearchClient();
		await c.replaceDoc(doc({ id: 1, ocrText: 'autism only' }));
		const none = await c.search({ match: 'autism seizures', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(none.total).toBe(0);
	});

	it('applies statusEquals and statusNotEquals filters', async () => {
		const c = new InMemorySearchClient();
		await c.replaceDoc(doc({ id: 1, status: 'submitted' }));
		await c.replaceDoc(doc({ id: 2, status: 'invalid' }));
		const eqOnly = await c.search({ match: 'autism', statusEquals: 'submitted', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(eqOnly.hits.map((h) => h.id)).toEqual([1]);
		const notInvalid = await c.search({ match: 'autism', statusNotEquals: 'invalid', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(notInvalid.hits.map((h) => h.id)).toEqual([1]);
	});

	it('paginates with limit/offset while reporting full total', async () => {
		const c = new InMemorySearchClient();
		for (let i = 1; i <= 5; i++) await c.replaceDoc(doc({ id: i }));
		const page = await c.search({ match: 'autism', limit: 2, offset: 2, fuzzy: false, fuzzyDistance: 2 });
		expect(page.total).toBe(5);
		expect(page.hits.length).toBe(2);
	});

	it('deleteDoc removes a document', async () => {
		const c = new InMemorySearchClient();
		await c.replaceDoc(doc({ id: 1 }));
		await c.deleteDoc(1);
		const r = await c.search({ match: 'autism', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.total).toBe(0);
	});
});
