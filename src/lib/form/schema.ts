import { z } from 'zod';
import { OPTIONS } from './options';

const optValues = (key: keyof typeof OPTIONS) => OPTIONS[key].map((o) => o.value) as [string, ...string[]];

const dateOfBirth = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= Date.now();
}, { message: 'must be ISO yyyy-mm-dd and not in the future' });

export const submissionSchema = z
  .object({
    childInfo: z.object({
      dateOfBirth: dateOfBirth,
      primaryLanguage: z.enum(optValues('primaryLanguage')).optional()
    }),
    developmentalHistory: z.object({
      developmentalConcerns: z.boolean().optional(),
      ageOfFirstConcern: z.enum(optValues('ageOfFirstConcern')).optional()
    }),
    diagnosis: z.object({
      hasFormalDiagnosis: z.boolean(),
      diagnosticStatus: z.enum(optValues('diagnosticStatus')).optional(),
      assessmentTools: z.array(z.enum(optValues('assessmentTools'))).optional()
    }),
    functionalImpact: z.object({
      communication: z.enum(optValues('communication')).optional(),
      socialInteraction: z.enum(optValues('socialInteraction')).optional(),
      dailyLivingSkills: z.enum(optValues('dailyLivingSkills')).optional(),
      behaviouralConcerns: z.enum(optValues('behaviouralConcerns')).optional()
    }),
    coOccurringConditions: z.object({
      conditions: z.array(z.enum(optValues('conditions'))).optional()
    }),
    currentSupports: z.object({
      services: z.array(z.enum(optValues('services'))).optional(),
      weeklyHours: z.number().nonnegative().max(168).optional()
    }),
    consent: z.object({
      informationAccurate: z.literal(true),
      dataSharingConsent: z.literal(true)
    }),
    browserFingerprint: z.string().max(256).optional(),
    csrfTokenEcho: z.string().max(256).optional()
  })
  .superRefine((val, ctx) => {
    const dc = val.developmentalHistory.developmentalConcerns;
    const age = val.developmentalHistory.ageOfFirstConcern;
    if (dc === true && !age) {
      ctx.addIssue({
        code: 'custom',
        path: ['developmentalHistory', 'ageOfFirstConcern'],
        message: 'required when developmental concerns is yes'
      });
    }
    if (dc !== true && age !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['developmentalHistory', 'ageOfFirstConcern'],
        message: 'must be empty when developmental concerns is not yes'
      });
    }
  });

export type SubmissionInput = z.infer<typeof submissionSchema>;
