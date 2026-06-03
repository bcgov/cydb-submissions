import { describe, it, expect, beforeAll } from 'vitest';
import { ManticoreClient } from '$lib/server/search/manticore';

const URL = process.env.MANTICORE_URL;
const d = URL ? describe : describe.skip;

d('ManticoreClient (integration — requires MANTICORE_URL)', () => {
	let c: ManticoreClient;
	beforeAll(async () => {
		c = new ManticoreClient(URL!);
		await c.ensureIndex();
		await c.replaceDoc({
			id: 1001, submissionUuid: 'int-1', status: 'submitted', createdAt: 1717230600,
			surname: 'Vernon', structuredText: 'primary language English co-occurring conditions ADHD',
			ocrText: 'The assessment indicates autism with notable speech delay and sensory processing concerns.',
			metadataText: 'Mozilla/5.0 en-CA'
		});
		await c.replaceDoc({
			id: 1002, submissionUuid: 'int-2', status: 'invalid', createdAt: 1717230600,
			surname: 'Other', structuredText: '', ocrText: 'unrelated content', metadataText: ''
		});
		await new Promise((r) => setTimeout(r, 300));
	});

	it('matches a lemma (assessment ~ assessments)', async () => {
		const r = await c.search({ match: 'assessments', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.hits.map((h) => h.id)).toContain(1001);
	});

	it('matches a prefix wildcard', async () => {
		const r = await c.search({ match: 'aut*', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.hits.map((h) => h.id)).toContain(1001);
	});

	it('matches a typo via fuzzy', async () => {
		const r = await c.search({ match: 'speach', limit: 10, offset: 0, fuzzy: true, fuzzyDistance: 2 });
		expect(r.hits.map((h) => h.id)).toContain(1001);
	});

	it('honours statusNotEquals', async () => {
		const r = await c.search({ match: 'content', statusNotEquals: 'invalid', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.hits.map((h) => h.id)).not.toContain(1002);
	});

	it('returns a highlighted snippet', async () => {
		const r = await c.search({ match: 'autism', limit: 10, offset: 0, fuzzy: false, fuzzyDistance: 2 });
		expect(r.hits[0].snippet.toLowerCase()).toContain('autism');
	});
});
