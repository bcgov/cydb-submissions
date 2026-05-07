export interface FormioConditional {
  show?: boolean | null;
  when?: string | null;
  eq?: string;
}

export function getByPath(state: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), state);
}

/**
 * Form.io v2 `conditional` evaluation. If conditional is empty/null we always show.
 * If `when` and `show` are both set, the field is shown iff string-equals(state[when], eq) === show.
 */
export function evaluateConditional(
  cond: FormioConditional | undefined,
  state: Record<string, unknown>
): boolean {
  if (!cond) return true;
  if (cond.show == null || !cond.when) return true;
  const actual = getByPath(state, cond.when);
  const matches = String(actual) === String(cond.eq ?? '');
  return cond.show ? matches : !matches;
}
