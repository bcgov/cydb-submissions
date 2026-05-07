import { describe, expect, it } from 'vitest';
import { OPTIONS, FIELDS } from '../../src/lib/form/options';

describe('form options', () => {
  it('exposes primaryLanguage choices including French and English', () => {
    const langs = OPTIONS.primaryLanguage.map((o) => o.value);
    expect(langs).toContain('English');
    expect(langs).toContain('French');
  });
  it('exposes 0..3 severity levels for functional-impact fields', () => {
    const comm = OPTIONS.communication.map((o) => o.value);
    expect(comm).toEqual(expect.arrayContaining(['0', '1', '2', '3']));
  });
  it('lists conditions checkbox options', () => {
    const cond = OPTIONS.conditions.map((o) => o.value);
    expect(cond.length).toBeGreaterThan(0);
    expect(cond).toContain('ID');
  });
  it('FIELDS lists every leaf input keyed by its dotted path', () => {
    expect(FIELDS).toContain('childInfo.dateOfBirth');
    expect(FIELDS).toContain('developmentalHistory.ageOfFirstConcern');
    expect(FIELDS).toContain('consent.dataSharingConsent');
  });
});
