import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapChefsSubmission } from '../../src/lib/server/chefs/mapper';

const cfg = {
	formId: 'f',
	apiToken: '',
	version: '1',
	baseUrl: 'https://x',
	fileComponents: ['AttachAssessment'],
	apiParams: {},
	pollerEnabled: false,
	pollIntervalMs: 1000
};
const yes = JSON.parse(readFileSync('tests/fixtures/chefs-submission-yes.json', 'utf8'));
const no = JSON.parse(readFileSync('tests/fixtures/chefs-submission-no.json', 'utf8'));

describe('mapChefsSubmission', () => {
	it('extracts one attachment per assessment row, tagged with its index', () => {
		const r = mapChefsSubmission(yes, cfg as any);
		expect(r.validationErrors).toBeNull();
		expect(r.attachments).toEqual([
			{ fileId: 'file-aaaa', originalName: 'diagnosis.pdf', assessmentIndex: 0 },
			{ fileId: 'file-bbbb', originalName: 'slp.pdf', assessmentIndex: 1 }
		]);
	});
	it('produces a valid normalized payload', () => {
		const r = mapChefsSubmission(yes, cfg as any);
		expect(r.payload.screening).toBe('Yes');
		expect(r.payload.editGrid?.[0].attachmentName).toBe('diagnosis.pdf');
	});
	it('derives submissionUuid from form.submissionId', () => {
		const r = mapChefsSubmission(yes, cfg as any);
		expect(r.submissionUuid).toBe('chefs_11111111-1111-1111-1111-111111111111');
	});
	it('maps the screening=No branch with no attachments', () => {
		const r = mapChefsSubmission(no, cfg as any);
		expect(r.validationErrors).toBeNull();
		expect(r.attachments).toEqual([]);
		expect(r.payload.screening).toBe('No');
		expect(r.payload.simplecheckboxes).toEqual(['iDoNotHaveAnyAssessmentInformation']);
	});
	it('reports validationErrors (not throw) for an invalid submission', () => {
		const bad = { ...yes, email: 'not-an-email' };
		const r = mapChefsSubmission(bad, cfg as any);
		expect(r.validationErrors).not.toBeNull();
		expect(Array.isArray(r.validationErrors)).toBe(true);
		// attachments are still extracted even when the payload is invalid
		expect(r.attachments).toHaveLength(2);
		// the raw payload is preserved for forensics
		expect(JSON.parse(r.rawPayloadJson).email).toBe('not-an-email');
	});
});
