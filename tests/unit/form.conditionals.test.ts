import { describe, expect, it } from 'vitest';
import { evaluateConditional } from '../../src/lib/form/conditionals';

describe('evaluateConditional (new form)', () => {
	it('shows editGrid when screening=Yes', () => {
		expect(
			evaluateConditional({ show: true, when: 'screening', eq: 'Yes' }, { screening: 'Yes' })
		).toBe(true);
		expect(
			evaluateConditional({ show: true, when: 'screening', eq: 'Yes' }, { screening: 'No' })
		).toBe(false);
	});
	it('shows reasons when screening=No', () => {
		expect(
			evaluateConditional({ show: true, when: 'screening', eq: 'No' }, { screening: 'No' })
		).toBe(true);
	});
	it('shows signature when PrimaryCareAndControl=Yes', () => {
		expect(
			evaluateConditional(
				{ show: true, when: 'PrimaryCareAndControl', eq: 'Yes' },
				{ PrimaryCareAndControl: 'Yes' }
			)
		).toBe(true);
	});
	it('always shows when no conditional', () => {
		expect(evaluateConditional(undefined, {})).toBe(true);
	});
});
