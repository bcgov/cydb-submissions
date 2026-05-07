import { describe, expect, it } from 'vitest';
import { evaluateConditional } from '../../src/lib/form/conditionals';

describe('evaluateConditional', () => {
  const state = {
    developmentalHistory: { developmentalConcerns: true }
  } as Record<string, any>;

  it('returns true when no conditional is defined', () => {
    expect(evaluateConditional(undefined, state)).toBe(true);
    expect(evaluateConditional({ show: null, when: null, eq: '' } as any, state)).toBe(true);
  });

  it('shows when when.path equals expected and show=true', () => {
    expect(evaluateConditional({
      show: true, when: 'developmentalHistory.developmentalConcerns', eq: 'true'
    }, state)).toBe(true);
  });

  it('hides when when.path equals expected and show=false', () => {
    expect(evaluateConditional({
      show: false, when: 'developmentalHistory.developmentalConcerns', eq: 'true'
    }, state)).toBe(false);
  });

  it('handles missing path as not-equal', () => {
    expect(evaluateConditional({
      show: true, when: 'diagnosis.hasFormalDiagnosis', eq: 'true'
    }, state)).toBe(false);
  });

  it('coerces booleans to strings for comparison', () => {
    expect(evaluateConditional({
      show: true, when: 'developmentalHistory.developmentalConcerns', eq: 'true'
    }, { developmentalHistory: { developmentalConcerns: true } })).toBe(true);
    expect(evaluateConditional({
      show: true, when: 'developmentalHistory.developmentalConcerns', eq: 'false'
    }, { developmentalHistory: { developmentalConcerns: false } })).toBe(true);
  });
});
