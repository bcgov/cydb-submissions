export type DecisionOutcome = 'accepted' | 'rejected';
export interface DecisionInput {
	decision: DecisionOutcome;
	reasonIds: number[];
}
export type ValidateResult =
	| { ok: true; decision: DecisionOutcome; reasons: string[] }
	| { ok: false; error: 'tier_not_selected' | 'empty_reasons' | 'unknown_or_inactive_reason' };

/**
 * Validate a decision against the currently-active reason list and produce the
 * snapshot reason texts. Accept => no reasons. Reject => >=1 reason, all of which
 * must be active reasons; the snapshot is the chosen texts in active-list order.
 */
export function validateDecision(
	input: DecisionInput,
	activeReasons: Array<{ id: number; text: string }>,
	activeAcceptReasons: Array<{ id: number; text: string }>,
	tierChoice: string | null
): ValidateResult {
	if (input.reasonIds.length === 0) return { ok: false, error: 'empty_reasons' };
	if (input.decision === 'accepted') {	
		if (tierChoice === null || !(tierChoice === 'tier one' || tierChoice === 'tier two')) {
			return { ok: false, error: 'tier_not_selected' };
		}
		const byId = new Map(activeAcceptReasons.map((r) => [r.id, r.text]));
		const chosen = new Set(input.reasonIds);
		for (const id of chosen)
			if (!byId.has(id)) return { ok: false, error: 'unknown_or_inactive_reason' };
		const reasons = activeAcceptReasons.filter((r) => chosen.has(r.id)).map((r) => r.text);
		return { ok: true, decision: 'accepted', reasons };
	}
	if (input.reasonIds.length === 0) return { ok: false, error: 'empty_reasons' };
	const byId = new Map(activeReasons.map((r) => [r.id, r.text]));
	const chosen = new Set(input.reasonIds);
	for (const id of chosen)
		if (!byId.has(id)) return { ok: false, error: 'unknown_or_inactive_reason' };
	const reasons = activeReasons.filter((r) => chosen.has(r.id)).map((r) => r.text);
	return { ok: true, decision: 'rejected', reasons };
}
