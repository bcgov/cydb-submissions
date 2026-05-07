import { describe, expect, it } from 'vitest';
import { submissionSchema } from '../../src/lib/form/schema';

const baseValid = {
  childInfo: { dateOfBirth: '2018-04-12', primaryLanguage: 'English' },
  developmentalHistory: { developmentalConcerns: true, ageOfFirstConcern: '1-2' },
  diagnosis: { hasFormalDiagnosis: false },
  functionalImpact: {},
  coOccurringConditions: { conditions: [] },
  currentSupports: { services: [], weeklyHours: 0 },
  consent: { informationAccurate: true, dataSharingConsent: true }
};

describe('submissionSchema', () => {
  it('accepts a complete valid payload', () => {
    const r = submissionSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
  });

  it('rejects missing dateOfBirth', () => {
    const bad = structuredClone(baseValid);
    // @ts-expect-error testing missing required field
    delete bad.childInfo.dateOfBirth;
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects future dateOfBirth', () => {
    const bad = structuredClone(baseValid);
    bad.childInfo.dateOfBirth = '2999-01-01';
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown primaryLanguage', () => {
    const bad = structuredClone(baseValid);
    bad.childInfo.primaryLanguage = 'Klingon';
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });

  it('requires ageOfFirstConcern when developmentalConcerns is true', () => {
    const bad = structuredClone(baseValid);
    delete bad.developmentalHistory.ageOfFirstConcern;
    bad.developmentalHistory.developmentalConcerns = true;
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });

  it('forbids ageOfFirstConcern when developmentalConcerns is false', () => {
    const bad = structuredClone(baseValid);
    bad.developmentalHistory.developmentalConcerns = false;
    bad.developmentalHistory.ageOfFirstConcern = '1-2';
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });

  it('requires both consent boxes literally true', () => {
    const bad = structuredClone(baseValid);
    bad.consent.dataSharingConsent = false as any;
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative weeklyHours', () => {
    const bad = structuredClone(baseValid);
    bad.currentSupports.weeklyHours = -1;
    expect(submissionSchema.safeParse(bad).success).toBe(false);
  });
});
