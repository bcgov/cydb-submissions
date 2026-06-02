import { describe, it, expect, vi, afterEach } from 'vitest';
import { ManticoreClient } from '$lib/server/search/manticore';
import { SearchQueryError } from '$lib/server/search/types';

afterEach(() => vi.restoreAllMocks());

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
	const spy = vi.fn(async (url: unknown, init: unknown) => impl(String(url), (init ?? {}) as RequestInit));
	vi.stubGlobal('fetch', spy);
	return spy;
}

describe('ManticoreClient.ensureIndex', () => {
	it('issues CREATE TABLE IF NOT EXISTS with morphology + min_infix_len', async () => {
		const spy = mockFetch(() => new Response(JSON.stringify([{ total: 0 }]), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		await c.ensureIndex();
		const body = String(spy.mock.calls[0][1].body);
		expect(spy.mock.calls[0][0]).toBe('http://mc:9308/sql?mode=raw');
		expect(decodeURIComponent(body)).toContain('CREATE TABLE IF NOT EXISTS submissions_idx');
		expect(decodeURIComponent(body)).toContain("morphology='lemmatize_en_all'");
		expect(decodeURIComponent(body)).toContain("min_infix_len='2'");
	});
});

describe('ManticoreClient.replaceDoc', () => {
	it('REPLACEs with escaped values', async () => {
		const spy = mockFetch(() => new Response(JSON.stringify([{ total: 1 }]), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		await c.replaceDoc({
			id: 5, submissionUuid: 'u5', status: 'submitted', createdAt: 1717230600,
			surname: "O'Brien", structuredText: 'language English', ocrText: 'speech', metadataText: 'UA'
		});
		const body = decodeURIComponent(String(spy.mock.calls[0][1].body));
		expect(body).toContain('REPLACE INTO submissions_idx');
		expect(body).toContain("'O''Brien'"); // single quote escaped
		expect(body).toContain('5');
	});
});

describe('ManticoreClient.search', () => {
	it('builds a bool query with status filter, fuzzy + highlight, and parses hits', async () => {
		const spy = mockFetch(() => new Response(JSON.stringify({
			hits: { total: 2, hits: [
				{ _id: 5, _score: 99, highlight: { ocr_text: ['...<b>autism</b> noted...'] } },
				{ _id: 6, _score: 80, highlight: { structured_text: ['ADHD'] } }
			] }
		}), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		const r = await c.search({ match: 'autism', statusNotEquals: 'invalid', limit: 25, offset: 0, fuzzy: true, fuzzyDistance: 2 });

		expect(spy.mock.calls[0][0]).toBe('http://mc:9308/search');
		const sent = JSON.parse(String(spy.mock.calls[0][1].body));
		expect(sent.index).toBe('submissions_idx');
		expect(sent.query.bool.must).toContainEqual({ query_string: 'autism' });
		expect(sent.query.bool.must_not).toContainEqual({ equals: { status: 'invalid' } });
		expect(sent.options.fuzzy).toBe(1);
		expect(sent.options.distance).toBe(2);

		expect(r.total).toBe(2);
		expect(r.hits[0]).toMatchObject({ id: 5, weight: 99 });
		expect(r.hits[0].snippet).toContain('autism');
	});

	it('throws SearchQueryError on an engine error response', async () => {
		mockFetch(() => new Response(JSON.stringify({ error: 'syntax error near "*"' }), { status: 400 }));
		const c = new ManticoreClient('http://mc:9308');
		await expect(c.search({ match: '* bad', limit: 25, offset: 0, fuzzy: true, fuzzyDistance: 2 })).rejects.toBeInstanceOf(SearchQueryError);
	});
});

describe('ManticoreClient.ping', () => {
	it('returns true on HTTP 200 and false on failure', async () => {
		mockFetch(() => new Response('[]', { status: 200 }));
		expect(await new ManticoreClient('http://mc:9308').ping()).toBe(true);
		vi.restoreAllMocks();
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('conn refused'); }));
		expect(await new ManticoreClient('http://mc:9308').ping()).toBe(false);
	});
});

describe('ManticoreClient sql-path error handling', () => {
	it('treats an array response with empty error as success (replaceDoc resolves)', async () => {
		mockFetch(() => new Response(JSON.stringify([{ total: 1, error: '', warning: '' }]), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		await expect(c.replaceDoc({
			id: 1, submissionUuid: 'u', status: 'submitted', createdAt: 1, surname: 'X',
			structuredText: '', ocrText: '', metadataText: ''
		})).resolves.toBeUndefined();
	});

	it('throws when an array response carries a non-empty error (HTTP 200)', async () => {
		mockFetch(() => new Response(JSON.stringify([{ total: 0, error: 'index already exists', warning: '' }]), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		await expect(c.deleteDoc(1)).rejects.toThrow(/manticore sql failed/);
	});

	it('ping returns false when SHOW TABLES reports an array error', async () => {
		mockFetch(() => new Response(JSON.stringify([{ error: 'boom' }]), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		expect(await c.ping()).toBe(false);
	});

	it('omits must_not from the search payload when there is no statusNotEquals', async () => {
		const spy = mockFetch(() => new Response(JSON.stringify({ hits: { total: 0, hits: [] } }), { status: 200 }));
		const c = new ManticoreClient('http://mc:9308');
		await c.search({ match: 'x', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		const sent = JSON.parse(String(spy.mock.calls[0][1].body));
		expect(sent.query.bool.must_not).toBeUndefined();
	});
});
