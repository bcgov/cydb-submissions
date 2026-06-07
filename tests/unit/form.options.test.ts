import { describe, expect, it } from 'vitest';
import { OPTIONS, FIELDS, ASSESSMENT_TYPE_PROFESSIONALS } from '../../src/lib/form/options';

describe('OPTIONS', () => {
	it('exposes gender options by component key', () => {
		expect(OPTIONS['childYouthsGender'].map((o) => o.value)).toEqual([
			'manBoy',
			'nonBinaryPerson',
			'womanGirl',
			'preferNotToAnswerUnknown'
		]);
	});
	it('exposes screening Yes/No', () => {
		expect(OPTIONS['screening'].map((o) => o.value)).toEqual(['Yes', 'No']);
	});
	it('exposes the seven not-submitting reasons', () => {
		expect(OPTIONS['simplecheckboxes'].map((o) => o.value)).toContain(
			'iDoNotHaveAnyAssessmentInformation'
		);
		expect(OPTIONS['simplecheckboxes']).toHaveLength(7);
	});
	it('derives assessment types from data.json', () => {
		expect(OPTIONS['AssessmentType'].map((o) => o.value)).toContain(
			'Autism Diagnostic Assessment Report/ Assessment'
		);
		expect(OPTIONS['AssessmentType']).toHaveLength(10);
	});
});

describe('ASSESSMENT_TYPE_PROFESSIONALS', () => {
	it('maps each assessment type to its professionals', () => {
		expect(ASSESSMENT_TYPE_PROFESSIONALS['Pediatrician Report or Assessment']).toEqual([
			'Pediatrician'
		]);
		expect(
			ASSESSMENT_TYPE_PROFESSIONALS['Autism Diagnostic Assessment Report/ Assessment']
		).toContain('BCAAN (British Columbia Autism Assessment Network)');
	});
});

describe('FIELDS', () => {
	it('includes new leaf keys and excludes layout panels', () => {
		expect(FIELDS).toContain('childYouthsFirstName');
		expect(FIELDS).toContain('screening');
		expect(FIELDS).not.toContain('sectionParentGuardian');
	});
});
