import { describe, it, expect } from 'vitest';
import { validateDecision } from '$lib/server/decision';

const REASONS = [
	{ id: 1, text: 'Incomplete information' },
	{ id: 2, text: 'Duplicate submission' }
];
const ACCEPT_REASONS = [
	{ id: 10, text: 'Meets criteria' },
	{ id: 11, text: 'Confirmed diagnosis' }
];

describe('validateDecision', () => {
	it('accept with no reasons is rejected', () => {
		expect(
			validateDecision({ decision: 'accepted', reasonIds: [] }, REASONS, ACCEPT_REASONS, 'tier one')
		).toEqual({ ok: false, error: 'empty_reasons' });
	});
	it('accept WITH accept reasons and a tier snapshots the texts in active-list order', () => {
		expect(
			validateDecision(
				{ decision: 'accepted', reasonIds: [11, 10] },
				REASONS,
				ACCEPT_REASONS,
				'tier two'
			)
		).toEqual({
			ok: true,
			decision: 'accepted',
			reasons: ['Meets criteria', 'Confirmed diagnosis']
		});
	});
	it('accept without a valid tier is rejected', () => {
		for (const tier of [null, '', 'tier three']) {
			expect(
				validateDecision({ decision: 'accepted', reasonIds: [10] }, REASONS, ACCEPT_REASONS, tier)
			).toEqual({ ok: false, error: 'tier_not_selected' });
		}
	});
	it('accept with an id that is not an active accept reason is rejected', () => {
		// id 1 is a reject reason, not an accept reason
		expect(
			validateDecision(
				{ decision: 'accepted', reasonIds: [1] },
				REASONS,
				ACCEPT_REASONS,
				'tier one'
			)
		).toEqual({ ok: false, error: 'unknown_or_inactive_reason' });
	});
	it('reject with zero reasons is rejected', () => {
		expect(
			validateDecision({ decision: 'rejected', reasonIds: [] }, REASONS, ACCEPT_REASONS, null)
		).toEqual({ ok: false, error: 'empty_reasons' });
	});
	it('reject with an unknown/inactive id is rejected', () => {
		expect(
			validateDecision({ decision: 'rejected', reasonIds: [1, 99] }, REASONS, ACCEPT_REASONS, null)
		).toEqual({ ok: false, error: 'unknown_or_inactive_reason' });
	});
	it('reject snapshots the chosen reason texts in active-list order', () => {
		expect(
			validateDecision({ decision: 'rejected', reasonIds: [2, 1] }, REASONS, ACCEPT_REASONS, null)
		).toEqual({
			ok: true,
			decision: 'rejected',
			reasons: ['Incomplete information', 'Duplicate submission']
		});
	});
});
