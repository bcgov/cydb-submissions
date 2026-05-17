import { describe, it, expect } from 'vitest';
import { mapChefsSubmission } from '$lib/server/chefs/mapper';
import type { ChefsConfig } from '$lib/server/chefs/types';

const cfg: ChefsConfig = {
  formId: 'f',
  apiToken: 't',
  version: '0',
  baseUrl: 'https://chefs.test',
  fileComponents: ['simplefile'],
  apiParams: {},
  pollerEnabled: false,
  pollIntervalMs: 60_000
};

const baseRaw = {
  form: { submissionId: 'sub-uuid-1', confirmationId: 'ABC123' },
  childInfo: { dateOfBirth: '2018-04-12', primaryLanguage: 'English' },
  developmentalHistory: { developmentalConcerns: true, ageOfFirstConcern: '1-2' },
  diagnosis: { hasFormalDiagnosis: true, diagnosticStatus: 'Confirmed', assessmentTools: ['Vineland'] },
  functionalImpact: {
    communication: '2',
    socialInteraction: '2',
    dailyLivingSkills: '1',
    behaviouralConcerns: '1'
  },
  coOccurringConditions: { conditions: ['ADHD'] },
  currentSupports: { services: ['SLP'], weeklyHours: 5 },
  consent: { informationAccurate: true, dataSharingConsent: true },
  simplefile: [
    { data: { id: 'file-1' }, originalName: 'report.pdf' },
    { data: { id: 'file-2' }, originalName: 'summary.docx' }
  ]
};

describe('mapChefsSubmission', () => {
  it('uses submissionId for the submission uuid (prefixed)', () => {
    const r = mapChefsSubmission(baseRaw, cfg);
    expect(r.submissionUuid).toBe('chefs_sub-uuid-1');
  });

  it('falls back to confirmationId when submissionId is missing', () => {
    const r = mapChefsSubmission({ ...baseRaw, form: { confirmationId: 'ABC123' } }, cfg);
    expect(r.submissionUuid).toBe('chefs_ABC123');
  });

  it('strips file_components from the payload and returns them in the manifest', () => {
    const r = mapChefsSubmission(baseRaw, cfg);
    expect(r.attachments).toEqual([
      { fileId: 'file-1', originalName: 'report.pdf' },
      { fileId: 'file-2', originalName: 'summary.docx' }
    ]);
    expect((r.payload as Record<string, unknown>).simplefile).toBeUndefined();
  });

  it('strips the form metadata block from the payload', () => {
    const r = mapChefsSubmission(baseRaw, cfg);
    expect((r.payload as Record<string, unknown>).form).toBeUndefined();
  });

  it('validates the payload against submissionSchema (success path)', () => {
    const r = mapChefsSubmission(baseRaw, cfg);
    expect(r.validationErrors).toBeNull();
  });

  it('returns a validationErrors array when consent flags are missing', () => {
    const bad = { ...baseRaw, consent: { informationAccurate: false, dataSharingConsent: true } };
    const r = mapChefsSubmission(bad, cfg);
    expect(r.validationErrors).not.toBeNull();
    expect(Array.isArray(r.validationErrors)).toBe(true);
  });

  it('throws when neither submissionId nor confirmationId is present', () => {
    const bad = { ...baseRaw, form: {} };
    expect(() => mapChefsSubmission(bad, cfg)).toThrow(/submissionId/i);
  });

  it('honours additional fileComponents from config', () => {
    const cfg2: ChefsConfig = { ...cfg, fileComponents: ['simplefile', 'supportingFiles'] };
    const raw2 = {
      ...baseRaw,
      supportingFiles: [{ data: { id: 'sf-1' }, originalName: 'extra.png' }]
    };
    const r = mapChefsSubmission(raw2, cfg2);
    expect(r.attachments).toHaveLength(3);
    expect(r.attachments.map((a) => a.fileId).sort()).toEqual(['file-1', 'file-2', 'sf-1']);
  });
});
