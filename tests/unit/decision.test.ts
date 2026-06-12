import { describe, it, expect } from 'vitest';
import { validateDecision } from '$lib/server/decision';

const REASONS = [
	{ id: 1, text: 'Incomplete information' },
	{ id: 2, text: 'Duplicate submission' }
];

describe('validateDecision', () => {
	it('accept with no reasons is valid', () => {
		expect(validateDecision({ decision: 'accepted', reasonIds: [] }, REASONS)).toEqual({
			ok: true,
			decision: 'accepted',
			reasons: []
		});
	});
	it('accept WITH reasons is rejected', () => {
		expect(validateDecision({ decision: 'accepted', reasonIds: [1] }, REASONS)).toEqual({
			ok: false,
			error: 'accept_has_reasons'
		});
	});
	it('reject with zero reasons is rejected', () => {
		expect(validateDecision({ decision: 'rejected', reasonIds: [] }, REASONS)).toEqual({
			ok: false,
			error: 'empty_reasons'
		});
	});
	it('reject with an unknown/inactive id is rejected', () => {
		expect(validateDecision({ decision: 'rejected', reasonIds: [1, 99] }, REASONS)).toEqual({
			ok: false,
			error: 'unknown_or_inactive_reason'
		});
	});
	it('reject snapshots the chosen reason texts in active-list order', () => {
		expect(validateDecision({ decision: 'rejected', reasonIds: [2, 1] }, REASONS)).toEqual({
			ok: true,
			decision: 'rejected',
			reasons: ['Incomplete information', 'Duplicate submission']
		});
	});
});
