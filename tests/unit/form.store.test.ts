import { describe, expect, it } from 'vitest';
import { createFormState } from '../../src/lib/form/store.svelte';

describe('form state store', () => {
  it('initialises with empty panels', () => {
    const s = createFormState();
    expect(s.value.consent).toEqual({ informationAccurate: false, dataSharingConsent: false });
  });
  it('round-trips set/get for nested fields', () => {
    const s = createFormState();
    s.set('childInfo.dateOfBirth', '2018-04-12');
    expect(s.get('childInfo.dateOfBirth')).toBe('2018-04-12');
  });
  it('clears ageOfFirstConcern when developmentalConcerns flips to false', () => {
    const s = createFormState();
    s.set('developmentalHistory.developmentalConcerns', true);
    s.set('developmentalHistory.ageOfFirstConcern', '1-2');
    s.set('developmentalHistory.developmentalConcerns', false);
    expect(s.get('developmentalHistory.ageOfFirstConcern')).toBeUndefined();
  });
});
