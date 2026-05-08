import type { SubmissionPayload } from './types';

const empty: SubmissionPayload = {
  childInfo: { dateOfBirth: '' },
  developmentalHistory: {},
  diagnosis: { hasFormalDiagnosis: false },
  functionalImpact: {},
  coOccurringConditions: { conditions: [] },
  currentSupports: { services: [], weeklyHours: undefined as unknown as number },
  consent: { informationAccurate: false as unknown as true, dataSharingConsent: false as unknown as true }
};

export interface FormState {
  value: SubmissionPayload;
  get(path: string): unknown;
  set(path: string, value: unknown): void;
}

export function createFormState(): FormState {
  let state = $state<SubmissionPayload>(structuredClone(empty));

  function set(path: string, value: unknown) {
    const segs = path.split('.');
    const last = segs.pop()!;
    let cur: any = state;
    for (const s of segs) {
      cur[s] ??= {};
      cur = cur[s];
    }
    cur[last] = value;
    if (path === 'developmentalHistory.developmentalConcerns' && value !== true) {
      delete (state.developmentalHistory as any).ageOfFirstConcern;
    }
  }

  function get(path: string) {
    return path.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), state);
  }

  return { get value() { return state; }, get, set };
}
