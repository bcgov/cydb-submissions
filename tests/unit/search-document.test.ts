import { describe, it, expect } from 'vitest';
import {
	labelFor,
	labelsFor,
	buildSearchDocument,
	toUnixSeconds
} from '$lib/server/search/document';
import type { SubmissionRowForIndex } from '$lib/server/search/document';

describe('labelFor / labelsFor', () => {
	it('maps a coded value to its human label', () => {
		expect(labelFor('childYouthsGender', 'nonBinaryPerson')).toMatch(/non.binary/i);
	});
	it('falls back to the raw value when there is no option list or match', () => {
		expect(labelFor('noSuchKey', 'x')).toBe('x');
		expect(labelFor('childYouthsGender', 'unknownCode')).toBe('unknownCode');
	});
	it('expands an array of coded values', () => {
		const labels = labelsFor('simplecheckboxes', ['iDoNotHaveAnyAssessmentInformation']);
		expect(labels.length).toBe(1);
		expect(labels[0]).toBeTruthy();
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

const row: SubmissionRowForIndex = {
	id: 1,
	submissionUuid: 'chefs_x',
	status: 'submitted',
	submitterSurname: 'Smith',
	childYouthFirstName: 'Jordan',
	childYouthLastName: 'Smith',
	childYouthDob: '2015-06-01',
	childYouthGender: 'nonBinaryPerson',
	signatoryFirstName: 'Alex',
	signatoryLastName: 'Smith',
	signatoryDob: '1985-02-20',
	screening: 'Yes',
	assessments: [
		{
			assessmentType: 'Pediatrician Report or Assessment',
			completedBy: 'Pediatrician',
			dateOfAssessment: '2024-09-10',
			attachmentName: 'a.pdf'
		}
	],
	notSubmittingReasons: null,
	createdAt: '2026-06-01 10:00:00'
};

describe('buildSearchDocument (new form)', () => {
	it('includes child and signatory names and assessment types', () => {
		const doc = buildSearchDocument(row, 'ocr words', 'meta words');
		const text = (doc as any).body ?? (doc as any).structuredText;
		expect(text).toContain('Jordan');
		expect(text).toContain('Smith');
		expect(text).toContain('Pediatrician Report or Assessment');
		// OCR text is stored in doc.ocrText, not in structuredText
		expect(doc.ocrText).toContain('ocr words');
	});

	it('populates id, submissionUuid, status, surname and unix createdAt', () => {
		const doc = buildSearchDocument(row, '', '');
		expect(doc.id).toBe(1);
		expect(doc.submissionUuid).toBe('chefs_x');
		expect(doc.status).toBe('submitted');
		expect(doc.surname).toBe('Smith');
		expect(doc.createdAt).toBe(Math.floor(Date.parse('2026-06-01T10:00:00Z') / 1000));
	});

	it('tolerates null/missing fields', () => {
		const minimal: SubmissionRowForIndex = {
			id: 2,
			submissionUuid: 'u2',
			status: 'submitted',
			submitterSurname: null,
			childYouthFirstName: 'Kai',
			childYouthLastName: 'Lee',
			childYouthDob: '2018-01-01',
			childYouthGender: 'manBoy',
			signatoryFirstName: 'Pat',
			signatoryLastName: 'Lee',
			signatoryDob: '1990-01-01',
			screening: 'No',
			notSubmittingReasons: null,
			assessments: null,
			createdAt: '2026-06-01 00:00:00'
		};
		const doc = buildSearchDocument(minimal, '', '');
		expect(doc.surname).toBe('');
		const text = (doc as any).body ?? (doc as any).structuredText;
		expect(text).toContain('status: submitted');
	});
});
