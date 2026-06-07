import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { submissionSchema } from '../../src/lib/form/schema';

const yes = JSON.parse(readFileSync('tests/fixtures/chefs-submission-yes.json', 'utf8'));
const no = JSON.parse(readFileSync('tests/fixtures/chefs-submission-no.json', 'utf8'));
// strip the CHEFS 'form' envelope as the mapper does
const strip = (o: any) => {
	const c = { ...o };
	delete c.form;
	return c;
};

describe('submissionSchema — screening=Yes', () => {
	it('accepts a valid submission and normalizes shapes', () => {
		const r = submissionSchema.safeParse(strip(yes));
		expect(r.success).toBe(true);
		if (!r.success) return;
		expect(r.data.PrimaryCareAndControl).toBe(true);
		expect(r.data.iAmTheAgreementSignatory).toBe(true);
		expect(r.data.editGrid).toHaveLength(2);
		expect(r.data.editGrid![0]).toMatchObject({
			assessmentType: 'Autism Diagnostic Assessment Report/ Assessment',
			completedBy: 'BCAAN (British Columbia Autism Assessment Network)',
			dateOfAssessment: '2024-09-10',
			attachmentName: 'diagnosis.pdf'
		});
	});

	it('rejects when an assessment has no attachment', () => {
		const bad = strip(yes);
		bad.editGrid = [{ ...yes.editGrid[0], AttachAssessment: [] }];
		expect(submissionSchema.safeParse(bad).success).toBe(false);
	});

	it('rejects completedBy not valid for the chosen assessment type (cascade)', () => {
		const bad = strip(yes);
		bad.editGrid = [{ ...yes.editGrid[0], completedBy: { name: 'Pediatrician' } }];
		const r = submissionSchema.safeParse(bad);
		expect(r.success).toBe(false);
	});

	it('rejects a child DOB before 2008-03-31', () => {
		const bad = strip(yes);
		bad.childYouthsDateOfBirth = '2007-01-01';
		expect(submissionSchema.safeParse(bad).success).toBe(false);
	});

	it('rejects an assessment dated in the future', () => {
		const bad = strip(yes);
		bad.editGrid = [{ ...yes.editGrid[0], dateOfAssessment: '2999-01-01' }];
		expect(submissionSchema.safeParse(bad).success).toBe(false);
	});

	it('rejects a signatory under 19 at date signed', () => {
		const bad = strip(yes);
		bad.childYouthsDateOfBirth1 = '2010-01-01';
		expect(submissionSchema.safeParse(bad).success).toBe(false);
	});
});

describe('submissionSchema — screening=No', () => {
	it('accepts the not-submitting branch and normalizes reasons + confirm box', () => {
		const r = submissionSchema.safeParse(strip(no));
		expect(r.success).toBe(true);
		if (!r.success) return;
		expect(r.data.screening).toBe('No');
		expect(r.data.simplecheckboxes).toEqual(['iDoNotHaveAnyAssessmentInformation']);
		expect(r.data.iAmTheAgreementSignatory2).toBe(true);
		expect(r.data.editGrid ?? []).toHaveLength(0);
	});
	it('rejects when no reason is selected', () => {
		const bad = strip(no);
		bad.simplecheckboxes = {};
		expect(submissionSchema.safeParse(bad).success).toBe(false);
	});
});
