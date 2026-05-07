// Mirrors the validated form payload accepted by the server action.
export interface SubmissionPayload {
  childInfo: {
    dateOfBirth: string;        // ISO yyyy-mm-dd
    primaryLanguage?: string;
  };
  developmentalHistory: {
    developmentalConcerns?: boolean;
    ageOfFirstConcern?: string; // shown only when developmentalConcerns === true
  };
  diagnosis: {
    hasFormalDiagnosis: boolean;
    diagnosticStatus?: string;
    assessmentTools?: string[];
  };
  functionalImpact: {
    communication?: string;
    socialInteraction?: string;
    dailyLivingSkills?: string;
    behaviouralConcerns?: string;
  };
  coOccurringConditions: {
    conditions?: string[];
  };
  currentSupports: {
    services?: string[];
    weeklyHours?: number;
  };
  consent: {
    informationAccurate: true;
    dataSharingConsent: true;
  };
  // Browser-supplied; validated but not authoritative.
  browserFingerprint?: string;
  csrfTokenEcho?: string;
}
