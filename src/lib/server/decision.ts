export type DecisionOutcome = 'accepted' | 'rejected';
export interface DecisionInput {
	decision: DecisionOutcome;
	reasonIds: number[];
}
export type ValidateResult =
	| { ok: true; decision: DecisionOutcome; reasons: string[] }
	| { ok: false; error: 'accept_has_reasons' | 'empty_reasons' | 'unknown_or_inactive_reason' };

/**
 * Validate a decision against the currently-active reason list and produce the
 * snapshot reason texts. Accept => no reasons. Reject => >=1 reason, all of which
 * must be active reasons; the snapshot is the chosen texts in active-list order.
 */
export function validateDecision(
	input: DecisionInput,
	activeReasons: Array<{ id: number; text: string }>,
	activeAcceptReasons: Array<{ id: number; text: string }>
): ValidateResult {
	if (input.reasonIds.length === 0) return { ok: false, error: 'empty_reasons' };
	if (input.decision === 'accepted') {	
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
