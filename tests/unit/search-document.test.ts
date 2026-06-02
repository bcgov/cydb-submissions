import { describe, it, expect } from 'vitest';
import { labelFor, labelsFor, buildSearchDocument, toUnixSeconds } from '$lib/server/search/document';

describe('labelFor / labelsFor', () => {
	it('maps a coded value to its human label', () => {
		expect(labelFor('communication', '2')).toBe('Moderate');
		expect(labelFor('diagnosticStatus', 'Confirmed')).toBe('Confirmed diagnosis');
	});
	it('falls back to the raw value when there is no option list or match', () => {
		expect(labelFor('communication', '99')).toBe('99');
		expect(labelFor('noSuchKey', 'x')).toBe('x');
	});
	it('expands an array of coded values', () => {
		expect(labelsFor('conditions', ['ID', 'ADHD'])).toEqual(['Intellectual disability', 'ADHD']);
	});
});

describe('toUnixSeconds', () => {
	const expected = Math.floor(Date.parse('2026-06-01T09:30:00Z') / 1000);
	it('parses SQLite space-separated UTC timestamps', () => {
		expect(toUnixSeconds('2026-06-01 09:30:00')).toBe(expected);
	});
	it('parses ISO-8601 timestamps that already end in Z (no double-Z bug)', () => {
		expect(toUnixSeconds('2026-06-01T09:30:00Z')).toBe(expected);
		expect(toUnixSeconds('2026-06-01T09:30:00Z')).not.toBe(0);
	});
	it('returns 0 for an unparseable value', () => {
		expect(toUnixSeconds('not-a-date')).toBe(0);
	});
});

describe('buildSearchDocument', () => {
	const row = {
		id: 7,
		submissionUuid: 'uuid-7',
		status: 'OCR processed',
		submitterSurname: 'Okafor',
		dateOfBirth: '2018-04-12',
		primaryLanguage: 'English',
		developmentalConcerns: true,
		ageOfFirstConcern: '18 months',
		hasFormalDiagnosis: true,
		diagnosticStatus: 'Confirmed',
		assessmentTools: ['Vineland 3', 'BCAAN'],
		communication: '2',
		socialInteraction: '3',
		dailyLivingSkills: '1',
		behaviouralConcerns: '0',
		conditions: ['ID', 'ADHD'],
		services: ['SLP'],
		weeklyHours: 4,
		createdAt: '2026-06-01 09:30:00'
	};

	it('builds a document with labels expanded and OCR/metadata text included', () => {
		const doc = buildSearchDocument(row as never, 'Vineland assessment shows speech delay', 'Mozilla/5.0 en-CA');
		expect(doc.id).toBe(7);
		expect(doc.submissionUuid).toBe('uuid-7');
		expect(doc.status).toBe('OCR processed');
		expect(doc.surname).toBe('Okafor');
		expect(doc.ocrText).toContain('speech delay');
		expect(doc.metadataText).toContain('Mozilla');
		// createdAt converted to unix seconds (SQLite 'YYYY-MM-DD HH:MM:SS' treated as UTC)
		expect(doc.createdAt).toBe(Math.floor(Date.parse('2026-06-01T09:30:00Z') / 1000));
		// structured text: surname + expanded labels + raw values
		expect(doc.structuredText).toContain('Okafor');
		expect(doc.structuredText).toContain('English');
		expect(doc.structuredText).toContain('Confirmed diagnosis');
		expect(doc.structuredText).toContain('Moderate'); // communication = 2
		expect(doc.structuredText).toContain('Intellectual disability'); // conditions: ID
		expect(doc.structuredText).toContain('ADHD');
		expect(doc.structuredText).toContain('Vineland 3');
	});

	it('tolerates null/missing fields', () => {
		const doc = buildSearchDocument(
			{ id: 1, submissionUuid: 'u', status: 'submitted', submitterSurname: null, createdAt: '2026-06-01 00:00:00' } as never,
			'',
			''
		);
		expect(doc.surname).toBe('');
		expect(doc.structuredText).toContain('status: submitted');
	});
});
